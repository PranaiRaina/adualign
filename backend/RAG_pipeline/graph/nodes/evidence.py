"""Assess whether handbook evidence needs trusted local web supplementation."""

from __future__ import annotations

import logging
from collections.abc import Mapping

from langsmith import traceable

from api.llm import FAST, build_chat_llm
from api.rate_limiting.llm_pricing import CHAT_COMPLETION_MODEL, REASONING_MINIMAL
from api.rate_limiting.llm_usage import record_langchain_usage
from api.utils import get_openrouter_key
from RAG_pipeline.schemas import EvidenceDecision, GraphState, _EVIDENCE_PROMPT
from RAG_pipeline.source_metadata import clean_source_text

logger = logging.getLogger(__name__)

_LOCAL_INTENT_PHRASES = (
    "at this address",
    "city of",
    "county",
    "in my area",
    "jurisdiction",
    "local",
    "municipal",
    "my property",
    "this property",
    "zoning code",
)
_LOCATION_VARIABLE_TERMS = (
    "design review",
    "fee",
    "inspection",
    "permit",
    "process",
    "timeline",
    "utility",
    "zoning",
)
_MAX_EVIDENCE_CHARS = 1200


def format_project_location(state: GraphState) -> str:
    frontend_context = state.get("frontend_context", {})
    location = [
        value
        for value in (frontend_context.get("address"), frontend_context.get("county"))
        if value
    ]
    return ", ".join(location) or "Not provided"


def _format_documents(state: GraphState) -> str:
    parts = []
    for index, document in enumerate(state.get("documents", []), start=1):
        text = clean_source_text(
            document.page_content,
            document.metadata.get("page_number"),
        )
        parts.append(f"[{index}] {text[:_MAX_EVIDENCE_CHARS]}")
    return "\n\n".join(parts) or "No relevant handbook excerpts were retrieved."


def build_web_search_query(state: GraphState) -> str:
    location = format_project_location(state)
    question = state.get("original_question") or state["question"]
    location_prefix = "" if location == "Not provided" else f"{location} "
    return f"{location_prefix}California ADU local regulations {question}".strip()


def question_may_need_local_evidence(state: GraphState) -> bool:
    question = (state.get("original_question") or state["question"]).lower()
    if any(phrase in question for phrase in _LOCAL_INTENT_PHRASES):
        return True
    has_location = format_project_location(state) != "Not provided"
    return has_location and any(term in question for term in _LOCATION_VARIABLE_TERMS)


def _set_strategy(state: GraphState, *, needs_web: bool) -> GraphState:
    state["evidence_strategy"] = "handbook_plus_web" if needs_web else "handbook_only"
    state["run_web_search"] = needs_web
    state["web_search_status"] = "pending" if needs_web else "not_requested"
    state["web_search_query"] = build_web_search_query(state) if needs_web else ""
    return state


@traceable(run_type="llm")
async def evidence_assessor_node(state: GraphState) -> GraphState:
    """Route to web evidence when handbook excerpts do not answer local intent."""
    if not state.get("documents"):
        logger.info("No relevant handbook evidence; requesting web search")
        return _set_strategy(state, needs_web=True)

    should_assess = state.get(
        "assess_local_evidence",
        question_may_need_local_evidence(state),
    )
    if not should_assess:
        logger.info("Statewide/general question; skipping local evidence assessment")
        return _set_strategy(state, needs_web=False)

    api_key = get_openrouter_key()
    if not api_key:
        logger.warning("No API key; using deterministic evidence routing")
        return _set_strategy(state, needs_web=should_assess)

    try:
        llm = build_chat_llm(
            tier=FAST,
            api_key=api_key,
            max_output_tokens=300,
            structured_output=EvidenceDecision,
            include_raw=True,
            reasoning_level=REASONING_MINIMAL,
        )
        result = await llm.ainvoke(
            _EVIDENCE_PROMPT.format(
                original_question=state.get("original_question") or state["question"],
                project_location=format_project_location(state),
                documents=_format_documents(state),
            )
        )
        raw_message = result.get("raw") if isinstance(result, Mapping) else None
        if raw_message is not None:
            record_langchain_usage(
                raw_message=raw_message,
                route="rag",
                source="rag.evidence_assessor",
                model=CHAT_COMPLETION_MODEL,
            )
        parsed = result.get("parsed") if isinstance(result, Mapping) else None
        if not isinstance(parsed, EvidenceDecision):
            raise ValueError("Evidence assessor returned no parsed decision")

        needs_web = parsed.strategy == "handbook_plus_web"
        logger.info(
            "Evidence strategy=%s answerability=%s",
            parsed.strategy,
            parsed.handbook_answerability,
        )
        return _set_strategy(state, needs_web=needs_web)
    except Exception as exc:
        logger.warning(
            "Evidence assessment failed; using deterministic routing: %s", exc
        )
        return _set_strategy(state, needs_web=should_assess)
