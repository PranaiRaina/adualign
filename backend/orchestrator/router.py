import asyncio
import json
import logging
import os
from contextlib import AsyncExitStack
from typing import cast

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from starlette.concurrency import run_in_threadpool
from .schemas import OrchestratorRequest, OrchestratorResponse, OrchestratorState
from .graph import (
    adu_graph,
    guardrail_node,
    hydrate_project_node,
    generate_welcome_summary_node,
    orchestrate_node,
    map_to_rag_state,
)
from financial_chatbot.schemas import ChatMessage as FinancialChatMessage
from financial_chatbot.service import stream_financial_chat
from RAG_pipeline.graph.nodes.rephraser import rephraser_node
from RAG_pipeline.graph.nodes.retriever import retriever_node
from RAG_pipeline.graph.nodes.grader import grader_node
from RAG_pipeline.graph.nodes.evidence import (
    build_web_search_query,
    evidence_assessor_node,
)
from RAG_pipeline.graph.nodes.web_search import web_search_node
from RAG_pipeline.graph.nodes.generator import (
    build_generation_context,
    stream_generation,
    generate_suggested_questions,
)
from RAG_pipeline.router import _extract_sources
from api.sse import sse_error_boundary
from api.database.models import User
from api.database.core import SessionLocal
from api.database.repository import ReportRepository
from api.authentication.auth import get_current_user
from api.rate_limiting.llm_usage import (
    LLMUsageAccumulator,
    log_rag_turn_usage,
    set_current_usage_accumulator,
    usage_accumulator_scope,
)
from api.errors import GENERIC_ERROR_MESSAGE
from api.rate_limiting.llm_pricing import CHAT_COMPLETION_MODEL
from api.rate_limiting.rate_limiter import reserve_llm_budget, ensure_user_api_key

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/agent")
RESUME_CHAT_MARKER = "SYSTEM_RESUME_CHAT"
RESUME_SUGGESTION_SEED = "The user has returned to an existing ADU project chat."


def require_authenticated_user_id(current_user: User | None) -> str:
    if current_user is None:
        raise HTTPException(
            status_code=401,
            detail="Authentication is required for orchestrator chat.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return cast(str, current_user.id)


@router.post("/orchestrate", response_model=OrchestratorResponse)
async def orchestrate_chat(
    req: OrchestratorRequest,
    current_user: User | None = Depends(get_current_user),
) -> OrchestratorResponse:
    validate_orchestrator_request(req)
    ensure_chat_api_key()
    current_user_id = require_authenticated_user_id(current_user)
    await run_in_threadpool(ensure_project_access, req.project_id, current_user_id)

    api_key_hash = await run_in_threadpool(ensure_user_api_key, current_user_id)

    try:
        with usage_accumulator_scope():
            async with reserve_llm_budget(
                api_key_hash=api_key_hash,
                route="orchestrator",
                fallback_cost_micros=15_000,
                model=CHAT_COMPLETION_MODEL,
            ):
                final_state = cast(
                    OrchestratorState,
                    await adu_graph.ainvoke(
                        build_initial_state(req, current_user_id=current_user_id)
                    ),
                )
    except HTTPException:
        raise
    except Exception:
        logger.exception("Graph execution failed")
        raise HTTPException(
            status_code=502,
            detail=GENERIC_ERROR_MESSAGE,
        )

    response = final_state.get("response")
    if response is None:
        raise HTTPException(
            status_code=502,
            detail=GENERIC_ERROR_MESSAGE,
        )

    await run_in_threadpool(
        persist_finance_state_if_present,
        req.project_id,
        current_user_id=current_user_id,
        finance_state=response.finance_state,
    )

    return response


# ── /agent/orchestrate/stream — SSE streaming through the orchestrator ──


@router.post("/orchestrate/stream")
async def orchestrate_stream(
    req: OrchestratorRequest,
    current_user: User | None = Depends(get_current_user),
):
    """Stream the orchestrator pipeline via Server-Sent Events.

    Runs safety scrub → routing → RAG/Finance pipeline with per-stage
    status updates and token-by-token answer streaming for the RAG path.
    """
    validate_orchestrator_request(req)
    ensure_chat_api_key()
    current_user_id = require_authenticated_user_id(current_user)
    await run_in_threadpool(ensure_project_access, req.project_id, current_user_id)
    initial_state = cast(
        OrchestratorState,
        build_initial_state(
            req,
            current_user_id=current_user_id,
        ),
    )
    is_resume = req.message.startswith(RESUME_CHAT_MARKER)
    api_key_hash = await run_in_threadpool(ensure_user_api_key, current_user_id)
    usage_accumulator = LLMUsageAccumulator()
    set_current_usage_accumulator(usage_accumulator)
    budget_stack: AsyncExitStack | None = None
    budget_ctx = None
    state: OrchestratorState = initial_state

    try:
        if not is_resume:
            async with reserve_llm_budget(
                api_key_hash=api_key_hash,
                route="guardrail",
                fallback_cost_micros=200,
                model=CHAT_COMPLETION_MODEL,
            ):
                state = await guardrail_node(state)

            if state.get("response") is not None:
                set_current_usage_accumulator(None)

                async def _blocked_stream():
                    yield f"data: {json.dumps({'text': state['response'].answer})}\n\n"
                    yield "event: done\ndata: {}\n\n"

                return StreamingResponse(
                    _blocked_stream(),
                    media_type="text/event-stream",
                    headers={
                        "Cache-Control": "no-cache",
                        "Connection": "keep-alive",
                        "X-Accel-Buffering": "no",
                    },
                )

        state = await hydrate_project_node(state)

        rephrased_rag_state: dict | None = None
        if is_resume:
            main_route = "rag"
            fallback_cost_micros = 6_000
        else:
            async with reserve_llm_budget(
                api_key_hash=api_key_hash,
                route="orchestrator",
                fallback_cost_micros=500,
                model=CHAT_COMPLETION_MODEL,
            ):
                # Rephrasing reads only the message and project context, so it
                # runs alongside routing (discarded on the finance route). Both
                # finish inside this reservation, so all usage stays billed;
                # return_exceptions keeps a routing failure from releasing the
                # reservation while the rephraser thread is still calling the LLM.
                routed, rephrased = await asyncio.gather(
                    orchestrate_node(state),
                    run_in_threadpool(rephraser_node, map_to_rag_state(state)),
                    return_exceptions=True,
                )
                if isinstance(routed, BaseException):
                    raise routed
                if isinstance(rephrased, BaseException):
                    raise rephrased
                state, rephrased_rag_state = routed, rephrased
            main_route = "finance" if state.get("route") == "ROUTE_FINANCE" else "rag"
            fallback_cost_micros = 15_000 if main_route == "finance" else 6_000

        budget_stack = AsyncExitStack()
        budget_ctx = await budget_stack.enter_async_context(
            reserve_llm_budget(
                api_key_hash=api_key_hash,
                route=main_route,
                fallback_cost_micros=fallback_cost_micros,
                model=CHAT_COMPLETION_MODEL,
            )
        )
    except Exception:
        set_current_usage_accumulator(None)
        raise

    async def _content_stream():
        nonlocal state
        if is_resume:
            yield f"event: status\ndata: {json.dumps({'stage': 'Generating your project summary...'})}\n\n"
            state = await generate_welcome_summary_node(state)
            summary = (
                state.get("welcome_summary")
                or "Welcome back! I'm ready to help with your ADU project."
            )
            yield f"data: {json.dumps({'text': summary})}\n\n"
            suggested = await generate_suggested_questions(
                RESUME_SUGGESTION_SEED, summary
            )
            yield f"event: suggested_questions\ndata: {json.dumps(suggested)}\n\n"
            return

        if budget_ctx is None:
            raise RuntimeError("Missing LLM budget context for orchestrator stream.")

        route = state.get("route", "ROUTE_RAG")
        logger.info("Orchestrator route selected", extra={"route": route})

        if route == "ROUTE_FINANCE":
            finance_history = []
            if req.history:
                for turn in req.history:
                    finance_history.append(
                        FinancialChatMessage(role=turn.role, content=turn.content)
                    )
            finance_history.append(
                FinancialChatMessage(role="user", content=req.message)
            )
            result = None
            async for event in stream_financial_chat(
                messages=finance_history,
                address=req.address,
                county=req.county,
                adu_sqft=req.adu_sqft,
                adu_width_ft=req.adu_width_ft,
                adu_length_ft=req.adu_length_ft,
                adu_type=req.adu_type,
                adu_shape=req.adu_shape,
                fire_hazard_severity=req.fire_hazard_severity,
                fire_hazard_zone_type=req.fire_hazard_zone_type,
                answer_safe_context=state.get("answer_safe_context") or None,
                project_id=req.project_id,
                current_user_id=state.get("current_user_id"),
                stored_finance_state=state.get("finance_state"),
            ):
                if event.event == "status":
                    yield (
                        "event: status\n"
                        f"data: {json.dumps({'stage': event.payload})}\n\n"
                    )
                    continue
                if event.event == "text":
                    yield f"data: {json.dumps({'text': event.payload})}\n\n"
                    continue
                if event.event == "sources":
                    yield f"event: sources\ndata: {json.dumps(event.payload)}\n\n"
                    continue
                if event.event == "suggested_questions":
                    yield (
                        "event: suggested_questions\n"
                        f"data: {json.dumps(event.payload)}\n\n"
                    )
                    continue
                if event.event == "finance_state":
                    yield (
                        f"event: finance_state\ndata: {json.dumps(event.payload)}\n\n"
                    )
                    continue
                if event.event == "result":
                    result = event.payload

            if result is None:
                raise RuntimeError("Finance stream ended without a final result.")

            state["finance_state"] = result.finance_state.model_dump(mode="json")
            state["finance_report_synced"] = result.report_synced
            state["response"] = OrchestratorResponse(
                answer=result.answer,
                sources=result.sources,
                finance_state=result.finance_state.model_dump(mode="json"),
            )
        else:
            # ── RAG path: stream token-by-token ──
            rag_usage_baseline = usage_accumulator.breakdown_count()
            if rephrased_rag_state is None:
                raise RuntimeError("Missing rephrased RAG state for RAG route.")
            rag_state = rephrased_rag_state
            frontend_context = rag_state["frontend_context"]

            # Web search depends only on the question and location, never on
            # the handbook results. When the rephraser flags local intent (the
            # only case where the evidence assessor may ask for the web), start
            # it now so it overlaps retrieval, grading and assessment; cancel
            # it if the assessor decides the handbook is enough.
            web_task: asyncio.Task | None = None
            web_query = ""
            if rag_state.get("assess_local_evidence"):
                web_query = build_web_search_query(rag_state)
                web_task = asyncio.create_task(
                    web_search_node(
                        {**rag_state, "documents": [], "web_search_query": web_query}
                    )
                )
            try:
                yield f"event: status\ndata: {json.dumps({'stage': 'Searching the handbook...'})}\n\n"
                rag_state = await run_in_threadpool(retriever_node, rag_state)

                yield f"event: status\ndata: {json.dumps({'stage': 'Checking relevance...'})}\n\n"
                rag_state = await grader_node(rag_state)
                rag_state = await evidence_assessor_node(rag_state)

                if rag_state.get("run_web_search", False):
                    yield f"event: status\ndata: {json.dumps({'stage': 'Searching the web...'})}\n\n"
                    if (
                        web_task is not None
                        and rag_state["web_search_query"] == web_query
                    ):
                        web_state = await web_task
                        rag_state["documents"] = (
                            rag_state.get("documents", []) + web_state["documents"]
                        )
                        rag_state["web_search_status"] = web_state["web_search_status"]
                    else:
                        rag_state = await web_search_node(rag_state)
            finally:
                if web_task is not None and not web_task.done():
                    web_task.cancel()

            documents = rag_state.get("documents", [])
            generation_context = build_generation_context(
                frontend_context,
                rag_state,
            )

            yield f"event: status\ndata: {json.dumps({'stage': 'Writing answer...'})}\n\n"

            full_answer = ""
            async for chunk in stream_generation(
                rag_state.get("original_question", rag_state["question"]),
                documents,
                generation_context,
            ):
                full_answer += chunk
                yield f"data: {json.dumps({'text': chunk})}\n\n"

            sources = _extract_sources(documents)
            yield f"event: sources\ndata: {json.dumps(sources)}\n\n"

            suggested = await generate_suggested_questions(
                rag_state["question"], full_answer
            )
            yield f"event: suggested_questions\ndata: {json.dumps(suggested)}\n\n"
            log_rag_turn_usage(prompt=req.message, since=rag_usage_baseline)

            # Update state with the response for history/consolidation
            state["response"] = OrchestratorResponse(
                answer=full_answer, sources=sources
            )

        stream_response = state.get("response")
        if stream_response is not None:
            await run_in_threadpool(
                persist_finance_state_if_present,
                req.project_id,
                current_user_id=current_user_id,
                finance_state=stream_response.finance_state,
            )

    return StreamingResponse(
        sse_error_boundary(
            _content_stream(),
            budget_ctx=budget_ctx,
            budget_stack=budget_stack,
            label="orchestrator stream",
            finalize=lambda: set_current_usage_accumulator(None),
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


def validate_orchestrator_request(req: OrchestratorRequest) -> None:
    if req.message and req.message.strip():
        return
    raise HTTPException(status_code=400, detail="message is required")


def ensure_chat_api_key() -> None:
    if os.getenv("OPENROUTER_API_KEY"):
        return
    raise HTTPException(
        status_code=503,
        detail="OPENROUTER_API_KEY environment variable not set.",
    )


def ensure_project_access(project_id: str | None, current_user_id: str | None) -> None:
    if not project_id:
        return
    if current_user_id is None:
        raise HTTPException(
            status_code=401,
            detail="Authentication is required for project-linked chat.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    with SessionLocal() as db:
        project = ReportRepository.get_project(
            db,
            project_id,
            user_id=current_user_id,
        )
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")


def persist_finance_state_if_present(
    project_id: str | None,
    *,
    current_user_id: str,
    finance_state: dict | None,
) -> None:
    if not project_id or not finance_state:
        return

    try:
        with SessionLocal() as db:
            ReportRepository.update_project_finance_state(
                db,
                project_id,
                finance_state,
                user_id=current_user_id,
            )
    except Exception:
        logger.exception(
            "Failed to persist finance state for project %s",
            project_id,
        )


def build_initial_state(
    req: OrchestratorRequest,
    *,
    current_user_id: str | None,
) -> dict:
    return {
        "request": req,
        "route": "",
        "response": None,
        "answer_safe_context": "",
        "internal_context": "",
        "finance_state": req.finance_state,
        "finance_report_synced": False,
        "is_new_session": False,
        "welcome_summary": None,
        "current_user_id": current_user_id,
    }
