"""
API Router for ADU RAG functionality.

Routes /chat requests through the CRAG (Corrective RAG) LangGraph
state machine. The graph handles rephrasing, retrieval, grading,
optional web search fallback, and final answer generation.

``/chat`` returns the full response at once.
``/chat/stream`` streams tokens via Server-Sent Events (SSE) so the
frontend can render text as it arrives.
"""

from __future__ import annotations

import json
import logging
import os
from contextlib import AsyncExitStack
from pathlib import Path
from typing import cast

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from starlette.concurrency import run_in_threadpool
from .schemas import ChatRequest, ChatResponse
from api.authentication.auth import get_current_user
from api.chat_guardrails import (
    GuardrailPolicy,
    build_turns_from_history,
    evaluate_guardrail_for_turns,
)
from api.database.models import User
from api.errors import GENERIC_ERROR_MESSAGE
from api.rate_limiting.llm_pricing import CHAT_COMPLETION_MODEL
from api.rate_limiting.llm_usage import (
    LLMUsageAccumulator,
    log_rag_turn_usage,
    usage_accumulator_scope,
)
from api.rate_limiting.rate_limiter import ensure_user_api_key, reserve_llm_budget
from api.sse import sse_error_boundary

from RAG_pipeline.graph.nodes.workflow import get_compiled_graph
from RAG_pipeline.graph.nodes.rephraser import rephraser_node
from RAG_pipeline.graph.nodes.retriever import retriever_node
from RAG_pipeline.graph.nodes.grader import grader_node
from RAG_pipeline.graph.nodes.evidence import evidence_assessor_node
from RAG_pipeline.graph.nodes.web_search import web_search_node
from RAG_pipeline.graph.nodes.generator import (
    build_generation_context,
    stream_generation,
    generate_suggested_questions,
)
from RAG_pipeline.source_metadata import (
    citation_pdf_url,
    clean_source_text,
    source_identity_key,
)

# Initialize the router
router = APIRouter()
logger = logging.getLogger(__name__)

# Paths
repo_root = Path(__file__).resolve().parent.parent
MAX_HISTORY_TURNS = 10
STREAMING_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


def get_secret(name: str) -> str | None:
    """Read secret from environment, with direct file fallback."""
    value = os.environ.get(name)
    if value and value.strip():
        return value.strip()

    for candidate in (repo_root / ".env",):
        if not candidate.exists():
            continue
        try:
            for line in candidate.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                if k.strip() == name and v.strip():
                    return v.strip().strip('"').strip("'")
        except Exception:
            continue
    return None


def require_rag_api_keys() -> None:
    for name in ("GEMINI_API_KEY", "OPENROUTER_API_KEY"):
        if not get_secret(name):
            raise HTTPException(status_code=503, detail=f"{name} not set.")


def _build_frontend_context(req: ChatRequest) -> dict:
    """Pack frontend params + history into a dict for the graph."""
    history_text = ""
    if req.history:
        for turn in req.history[-MAX_HISTORY_TURNS * 2 :]:
            if turn.role in ("user", "assistant"):
                role = "User" if turn.role == "user" else "Assistant"
                history_text += f"{role}: {turn.content}\n\n"

    return {
        "address": req.address,
        "county": req.county,
        "adu_sqft": req.adu_sqft,
        "adu_type": req.adu_type,
        "primary_use": req.primary_use,
        "blocker_types": req.blocker_types,
        "has_existing_structure": req.has_existing_structure,
        "current_yard_zone": req.current_yard_zone,
        "finance_state": req.finance_state,
        "adu_clearances": [
            clearance.model_dump(mode="json") for clearance in req.adu_clearances
        ],
        "history_text": history_text,
    }


def _extract_sources(documents: list) -> list[dict]:
    """Build sources list from Document objects, including chunk text for the drawer."""
    seen: set[str] = set()
    sources: list[dict] = []
    for doc in documents:
        meta = doc.metadata if hasattr(doc, "metadata") else {}
        key = source_identity_key(doc)
        if key in seen:
            continue
        seen.add(key)
        page_num = meta.get("page_number")
        source_file = meta.get("source", "adu_handbook")
        url = meta.get("url")
        chunk_text = ""
        if hasattr(doc, "page_content") and doc.page_content:
            chunk_text = clean_source_text(doc.page_content, page_num)[:600]
        sources.append(
            {
                "page_number": page_num,
                "source": source_file,
                "regulation_topic": meta.get("regulation_topic"),
                "chunk_text": chunk_text,
                "url": url,
                "citation_url": citation_pdf_url(meta),
            }
        )
    return sources


def _require_chat_user_id(current_user: User | None) -> str:
    if current_user is None:
        raise HTTPException(
            status_code=401,
            detail="Authentication is required for chat.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return cast(str, current_user.id)


def _build_graph_state(query: str, frontend_context: dict) -> dict:
    return {
        "question": query,
        "original_question": query,
        "documents": [],
        "run_web_search": False,
        "assess_local_evidence": False,
        "evidence_strategy": "handbook_only",
        "web_search_query": "",
        "web_search_status": "not_requested",
        "generation": "",
        "frontend_context": frontend_context,
    }


# ── /chat endpoint (batch, full response) ───────────────────────────


@router.post("/chat", response_model=ChatResponse)
async def chat(
    req: ChatRequest,
    current_user: User | None = Depends(get_current_user),
) -> ChatResponse:
    if not req.message or not req.message.strip():
        raise HTTPException(status_code=400, detail="message is required")
    current_user_id = _require_chat_user_id(current_user)

    require_rag_api_keys()
    api_key_hash = await run_in_threadpool(ensure_user_api_key, current_user_id)

    try:
        with usage_accumulator_scope() as usage_accumulator:
            async with reserve_llm_budget(
                api_key_hash=api_key_hash,
                route="guardrail",
                fallback_cost_micros=200,
                model=CHAT_COMPLETION_MODEL,
            ):
                guardrail_result = await evaluate_guardrail_for_turns(
                    turns=build_turns_from_history(
                        message=req.message, history=req.history
                    ),
                    policy=GuardrailPolicy.ADU_GENERAL,
                )

            if not guardrail_result.is_allowed:
                return ChatResponse(
                    answer=guardrail_result.denial_message or "",
                    sources=[],
                )

            req = req.model_copy(
                update={
                    "message": guardrail_result.sanitized_message,
                    "history": guardrail_result.sanitized_history or None,
                }
            )
            query = req.message.strip()
            frontend_context = _build_frontend_context(req)
            rag_usage_baseline = usage_accumulator.breakdown_count()

            async with reserve_llm_budget(
                api_key_hash=api_key_hash,
                route="rag",
                fallback_cost_micros=6_000,
                model=CHAT_COMPLETION_MODEL,
            ):
                graph = get_compiled_graph()
                result = await graph.ainvoke(
                    _build_graph_state(query, frontend_context)
                )

                answer = result.get("generation", "").strip()
                if not answer:
                    answer = (
                        "I was unable to generate a response. "
                        "Please try rephrasing your question."
                    )

                sources = _extract_sources(result.get("documents", []))
                suggested_questions = await generate_suggested_questions(query, answer)
                log_rag_turn_usage(prompt=query, since=rag_usage_baseline)

    except Exception as exc:
        if isinstance(exc, HTTPException):
            raise
        logger.exception("RAG graph execution failed")
        raise HTTPException(
            status_code=502,
            detail=GENERIC_ERROR_MESSAGE,
        ) from exc

    return ChatResponse(
        answer=answer, sources=sources, suggested_questions=suggested_questions
    )


# ── /chat/stream endpoint (SSE, tokens appear as they generate) ─────


@router.post("/chat/stream")
async def chat_stream(
    req: ChatRequest,
    current_user: User | None = Depends(get_current_user),
):
    """Stream the generator's response via Server-Sent Events.

    Phase 1 (silent): runs rephraser → retriever → grader → web_search
    Phase 2 (streamed): sends each generated token as an SSE ``data:`` event.
    Final event: ``event: sources`` with the retrieved document metadata.
    """
    if not req.message or not req.message.strip():
        raise HTTPException(status_code=400, detail="message is required")
    current_user_id = _require_chat_user_id(current_user)

    require_rag_api_keys()
    api_key_hash = await run_in_threadpool(ensure_user_api_key, current_user_id)

    usage_accumulator = LLMUsageAccumulator()
    budget_stack: AsyncExitStack | None = None
    budget_ctx = None

    try:
        with usage_accumulator_scope(usage_accumulator):
            async with reserve_llm_budget(
                api_key_hash=api_key_hash,
                route="guardrail",
                fallback_cost_micros=200,
                model=CHAT_COMPLETION_MODEL,
            ):
                guardrail_result = await evaluate_guardrail_for_turns(
                    turns=build_turns_from_history(
                        message=req.message, history=req.history
                    ),
                    policy=GuardrailPolicy.ADU_GENERAL,
                )

            if not guardrail_result.is_allowed:

                async def _blocked_stream():
                    yield f"data: {json.dumps({'text': guardrail_result.denial_message or ''})}\n\n"
                    yield "event: done\ndata: {}\n\n"

                return StreamingResponse(
                    _blocked_stream(),
                    media_type="text/event-stream",
                    headers=STREAMING_HEADERS,
                )

            req = req.model_copy(
                update={
                    "message": guardrail_result.sanitized_message,
                    "history": guardrail_result.sanitized_history or None,
                }
            )
            query = req.message.strip()
            frontend_context = _build_frontend_context(req)
            budget_stack = AsyncExitStack()
            budget_ctx = await budget_stack.enter_async_context(
                reserve_llm_budget(
                    api_key_hash=api_key_hash,
                    route="rag",
                    fallback_cost_micros=6_000,
                    model=CHAT_COMPLETION_MODEL,
                )
            )
    except Exception:
        if budget_stack is not None:
            await budget_stack.aclose()
        raise

    async def _content_stream():
        """Generate SSE content events (the error boundary adds the terminal done)."""
        if budget_ctx is None:
            raise RuntimeError("Missing LLM budget context for RAG stream.")

        with usage_accumulator_scope(usage_accumulator):
            rag_usage_baseline = usage_accumulator.breakdown_count()
            state = _build_graph_state(query, frontend_context)

            yield f"event: status\ndata: {json.dumps({'stage': 'Rephrasing your question...'})}\n\n"
            state = await run_in_threadpool(rephraser_node, state)

            yield f"event: status\ndata: {json.dumps({'stage': 'Searching the handbook...'})}\n\n"
            state = await run_in_threadpool(retriever_node, state)

            yield f"event: status\ndata: {json.dumps({'stage': 'Checking relevance...'})}\n\n"
            state = await grader_node(state)
            state = await evidence_assessor_node(state)

            if state.get("run_web_search", False):
                yield f"event: status\ndata: {json.dumps({'stage': 'Searching the web...'})}\n\n"
                state = await web_search_node(state)

            documents = state.get("documents", [])
            generation_context = build_generation_context(frontend_context, state)

            yield f"event: status\ndata: {json.dumps({'stage': 'Writing answer...'})}\n\n"

            full_answer = ""
            async for chunk in stream_generation(query, documents, generation_context):
                full_answer += chunk
                yield f"data: {json.dumps({'text': chunk})}\n\n"

            sources = _extract_sources(documents)
            yield f"event: sources\ndata: {json.dumps(sources)}\n\n"

            suggested = await generate_suggested_questions(query, full_answer)
            yield f"event: suggested_questions\ndata: {json.dumps(suggested)}\n\n"
            log_rag_turn_usage(prompt=query, since=rag_usage_baseline)

    return StreamingResponse(
        sse_error_boundary(
            _content_stream(),
            budget_ctx=budget_ctx,
            budget_stack=budget_stack,
            label="direct RAG stream",
        ),
        media_type="text/event-stream",
        headers=STREAMING_HEADERS,
    )
