import logging
import os

from typing import TYPE_CHECKING, Any, cast
from langgraph.graph import StateGraph, END
from langchain_core.messages import HumanMessage, SystemMessage
from starlette.concurrency import run_in_threadpool

from api.llm import FAST, build_chat_llm
from api.rate_limiting.llm_pricing import (
    CHAT_COMPLETION_MODEL,
)
from api.rate_limiting.llm_usage import record_langchain_usage
from api.chat_guardrails import (
    GuardrailPolicy,
    build_turns_from_history,
    evaluate_guardrail_for_turns,
)
from api.property_context import normalize_adu_clearances
from api.utils import format_tagged_block, format_tagged_turns
from financial_chatbot.schemas import ChatMessage as FinancialChatMessage
from financial_chatbot.service import run_financial_chat
from RAG_pipeline.graph.nodes.workflow import get_compiled_graph
from RAG_pipeline.router import _extract_sources
from .schemas import OrchestratorResponse, OrchestratorState, _ORCHESTRATOR_PROMPT
from .hydration import compose_property_context

if TYPE_CHECKING:
    from .schemas import OrchestratorRequest
    from api.database.models import Project

logger = logging.getLogger(__name__)


def _message_text(content: str | list[str | dict[Any, Any]] | None) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(part if isinstance(part, str) else str(part) for part in content)
    return ""


# ---------------------------------------------------------------------------
# Nodes
# ---------------------------------------------------------------------------


async def guardrail_node(state: OrchestratorState) -> OrchestratorState:
    req = state["request"]
    turns = build_turns_from_history(message=req.message, history=req.history)
    guardrail_result = await evaluate_guardrail_for_turns(
        turns=turns,
        policy=GuardrailPolicy.ADU_GENERAL,
    )

    if not guardrail_result.is_allowed:
        logger.info(
            "Guardrail blocked orchestrator request: %s", guardrail_result.reason_code
        )
        return {
            **state,
            "route": "BLOCKED",
            "response": OrchestratorResponse(
                answer=guardrail_result.denial_message or "",
                finance_state=state.get("finance_state"),
            ),
        }

    updated_req = req.model_copy(
        update={
            "history": guardrail_result.sanitized_history or None,
            "message": guardrail_result.sanitized_message,
        }
    )

    return {**state, "request": updated_req}


async def hydrate_project_node(state: OrchestratorState) -> OrchestratorState:
    """Hydrate chat from saved project fields without reading report data."""
    req = state["request"]
    answer_safe_context = ""
    internal_context = ""
    finance_state = state.get("finance_state")
    current_user_id = state.get("current_user_id")

    if req.project_id:
        if not current_user_id:
            logger.warning(
                "Skipping project hydration without authenticated project owner"
            )
            return {
                **state,
                "answer_safe_context": answer_safe_context,
                "internal_context": internal_context,
                "finance_state": finance_state,
                "is_new_session": not bool(req.history),
            }
        try:
            answer_safe_context, finance_state = await run_in_threadpool(
                _hydrate_project_context,
                req,
                current_user_id,
                finance_state,
            )
        except Exception as exc:
            logger.warning(f"Project hydration failed, continuing without: {exc}")

    is_new_session = not bool(req.history)
    return {
        **state,
        "answer_safe_context": answer_safe_context,
        "internal_context": internal_context,
        "finance_state": finance_state,
        "is_new_session": is_new_session,
    }


def _hydrate_project_context(
    req: "OrchestratorRequest",
    current_user_id: str,
    finance_state: dict | None,
) -> tuple[str, dict | None]:
    from api.database.core import SessionLocal
    from api.database.repository import ReportRepository

    project_id = req.project_id
    if not project_id:
        return "", finance_state

    with SessionLocal() as db:
        project = ReportRepository.get_project(
            db,
            project_id,
            user_id=current_user_id,
        )
        if not project:
            return "", finance_state

        _backfill_request_from_project(req, project)
        project_finance_state = getattr(project, "finance_state", None)
        if finance_state is None and project_finance_state is not None:
            finance_state = project_finance_state
        answer_safe_context = compose_property_context(project)
        logger.info(
            f"Hydrated project {project_id[:8]}… "
            f"({len(answer_safe_context)} context chars)"
        )
        return answer_safe_context, finance_state


def _backfill_request_from_project(
    req: "OrchestratorRequest",
    project: "Project",
) -> None:
    """
    Copy property fields from the stored Project into the request
    when the frontend didn't supply them (i.e. they are None / empty).

    Mutates ``req`` in place — this is safe because the request object
    is only used within this single invocation.
    """
    _FIELD_MAP = {
        # request field  → project attribute
        "address": "address",
        "county": "county",
        "adu_sqft": "adu_sqft",
        "adu_width_ft": "adu_width_ft",
        "adu_length_ft": "adu_length_ft",
        "adu_type": "adu_type",
        "adu_shape": "adu_shape",
        "primary_use": "primary_use",
        "fire_hazard_severity": "fire_hazard_severity",
        "fire_hazard_zone_type": "fire_hazard_zone_type",
        "current_yard_zone": "current_yard_zone",
    }
    for req_field, proj_attr in _FIELD_MAP.items():
        if getattr(req, req_field, None) is None:
            proj_val = getattr(project, proj_attr, None)
            if proj_val is not None:
                object.__setattr__(req, req_field, proj_val)

    # blocker_types: backfill when empty list (default) and project has data
    if not req.blocker_types:
        proj_blockers = getattr(project, "blocker_types", None)
        if proj_blockers:
            object.__setattr__(req, "blocker_types", proj_blockers)
    if not req.adu_clearances:
        project_clearances = getattr(project, "adu_clearances", None)
        if project_clearances:
            object.__setattr__(
                req,
                "adu_clearances",
                normalize_adu_clearances(project_clearances),
            )

    logger.info(
        f"Backfilled request from project {cast(str, project.id)[:8]}… (address={req.address!r})"
    )


_WELCOME_SUMMARY_PROMPT = """\
You are a friendly ADU Advisor. The user has just returned to their project.
Write a warm, concise 4-5 sentence summary of where their ADU project stands \
based on the saved project data below.
Focus on the most important facts: address, ADU type, size, and saved constraints.
Do not use bullet points. Do not ask questions. Just write a friendly recap paragraph.
"""


async def generate_welcome_summary_node(state: OrchestratorState) -> OrchestratorState:
    """
    Generates a friendly 2-3 sentence project recap for returning users.
    Only runs when is_new_session=True and answer-safe project context exists.
    For SYSTEM_RESUME_CHAT messages, also sets response so the graph can END.
    """
    req = state["request"]
    answer_safe_context = state.get("answer_safe_context", "")
    is_resume = req.message.startswith("SYSTEM_RESUME_CHAT")

    summary = await _call_welcome_summary_llm(answer_safe_context)

    updates: dict = {"welcome_summary": summary}
    if is_resume:
        answer = summary or "Welcome back! I'm ready to help with your ADU project."
        updates["response"] = OrchestratorResponse(
            answer=answer,
            finance_state=state.get("finance_state"),
        )

    return {**state, **updates}


async def _call_welcome_summary_llm(answer_safe_context: str) -> str | None:
    if "## PROPERTY DATA ##" not in answer_safe_context:
        return None
    api_key = os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        return None
    try:
        llm = build_chat_llm(tier=FAST, api_key=api_key, temperature=None)
        result = await llm.ainvoke(
            [
                SystemMessage(content=_WELCOME_SUMMARY_PROMPT),
                HumanMessage(content=answer_safe_context),
            ]
        )
        record_langchain_usage(
            raw_message=result,
            route="orchestrator",
            source="orchestrator.welcome_summary",
            model=CHAT_COMPLETION_MODEL,
        )
        return _message_text(result.content).strip() or None
    except Exception as exc:
        logger.warning(f"Welcome summary generation failed: {exc}")
        return None


_VALID_ROUTES = {"ROUTE_FINANCE", "ROUTE_RAG"}
_MAX_ROUTE_RETRIES = 3


async def orchestrate_node(state: OrchestratorState) -> OrchestratorState:
    req = state["request"]
    api_key = os.getenv("OPENROUTER_API_KEY")
    answer_safe_context = state.get("answer_safe_context", "")

    history_text = format_tagged_turns(req.history)

    # Build the full input — inject report context if available
    input_parts = []
    if answer_safe_context:
        input_parts.append(f"Project Context:\n{answer_safe_context}\n")
    input_parts.append(f"Conversation History:\n{history_text}")
    input_parts.append(
        f"User's new message:\n{format_tagged_block('user_message', req.message)}"
    )
    full_input = "\n".join(input_parts)

    llm = build_chat_llm(tier=FAST, api_key=api_key, temperature=None)
    messages = [
        SystemMessage(content=_ORCHESTRATOR_PROMPT),
        HumanMessage(content=full_input),
    ]

    route = None
    for attempt in range(1, _MAX_ROUTE_RETRIES + 1):
        result = await llm.ainvoke(messages)
        record_langchain_usage(
            raw_message=result,
            route="orchestrator",
            source="orchestrator.router",
            model=CHAT_COMPLETION_MODEL,
        )
        candidate = _message_text(result.content).strip().upper()
        if candidate in _VALID_ROUTES:
            route = candidate
            break
        logger.warning(
            f"Invalid route on attempt {attempt}/{_MAX_ROUTE_RETRIES}: {candidate!r}"
        )

    if route is None:
        logger.error(
            f"LLM returned invalid route {_MAX_ROUTE_RETRIES} times, defaulting to ROUTE_RAG"
        )
        route = "ROUTE_RAG"

    return {**state, "route": route}


async def financial_agent_node(state: OrchestratorState) -> OrchestratorState:
    req = state["request"]
    answer_safe_context = state.get("answer_safe_context", "")
    fin_history = []

    if req.history:
        for turn in req.history:
            fin_history.append(
                FinancialChatMessage(role=turn.role, content=turn.content)
            )
    fin_history.append(FinancialChatMessage(role="user", content=req.message))

    result = await run_financial_chat(
        messages=fin_history,
        address=req.address,
        county=req.county,
        adu_sqft=req.adu_sqft,
        adu_width_ft=req.adu_width_ft,
        adu_length_ft=req.adu_length_ft,
        adu_type=req.adu_type,
        adu_shape=req.adu_shape,
        fire_hazard_severity=req.fire_hazard_severity,
        fire_hazard_zone_type=req.fire_hazard_zone_type,
        answer_safe_context=answer_safe_context or None,
        project_id=req.project_id,
        current_user_id=state.get("current_user_id"),
        stored_finance_state=state.get("finance_state"),
    )

    return {
        **state,
        "finance_state": result.finance_state.model_dump(mode="json"),
        "finance_report_synced": result.report_synced,
        "response": OrchestratorResponse(
            answer=result.answer,
            sources=result.sources,
            finance_state=result.finance_state.model_dump(mode="json"),
        ),
    }


# ---------------------------------------------------------------------------
# Subgraph Mappers
# ---------------------------------------------------------------------------


def map_to_rag_state(state: OrchestratorState) -> dict:
    """Maps OrchestratorState -> RAG Pipeline's GraphState."""
    req = state["request"]
    answer_safe_context = state.get("answer_safe_context", "")

    # Build history_text the same way _build_frontend_context does in the RAG router,
    # so the generator prompt includes conversation context.
    history_text = ""
    if req.history:
        for turn in req.history[-20:]:
            if turn.role in ("user", "assistant"):
                role = "User" if turn.role == "user" else "Assistant"
                history_text += f"{role}: {turn.content}\n\n"

    frontend_context = {
        "adu_clearances": [
            clearance.model_dump(mode="json")
            for clearance in normalize_adu_clearances(req.adu_clearances)
        ],
        "address": req.address,
        "county": req.county,
        "adu_sqft": req.adu_sqft,
        "adu_width_ft": req.adu_width_ft,
        "adu_length_ft": req.adu_length_ft,
        "adu_type": req.adu_type,
        "adu_shape": req.adu_shape,
        "primary_use": req.primary_use,
        "blocker_types": req.blocker_types,
        "has_existing_structure": req.has_existing_structure,
        "current_yard_zone": req.current_yard_zone,
        "finance_state": state.get("finance_state"),
        "history_text": history_text,
    }

    # Inject report context into the RAG pipeline's frontend_context
    # so the generator node can use it for situational awareness
    if answer_safe_context:
        frontend_context["answer_safe_context"] = answer_safe_context

    return {
        "question": req.message,  # mutable — rephraser will rewrite for retrieval
        "original_question": req.message,  # frozen — generator reads this for tone/brevity cues
        "documents": [],
        "run_web_search": False,
        "assess_local_evidence": False,
        "evidence_strategy": "handbook_only",
        "web_search_query": "",
        "web_search_status": "not_requested",
        "generation": "",
        "frontend_context": frontend_context,
    }


def map_from_rag_state(
    rag_state: dict,
    finance_state: dict | None,
) -> dict:
    """Maps RAG GraphState -> OrchestratorState update."""

    answer = rag_state.get("generation", "").strip()
    if not answer:
        answer = "I was unable to retrieve a specific answer from the handbook."

    sources = _extract_sources(rag_state.get("documents", []))

    return {
        "response": OrchestratorResponse(
            answer=answer,
            sources=sources,
            finance_state=finance_state,
        )
    }


async def rag_agent_node(state: OrchestratorState) -> OrchestratorState:
    """Invokes the RAG pipeline as a native nested subgraph."""
    rag_graph = get_compiled_graph()
    rag_input = map_to_rag_state(state)

    # Run the subgraph
    rag_output = await rag_graph.ainvoke(rag_input)

    # Merge result back into orchestrator state
    update = map_from_rag_state(rag_output, state.get("finance_state"))
    return {**state, **update}


# ---------------------------------------------------------------------------
# Routing function (conditional edge)
# ---------------------------------------------------------------------------


def route_decision(state: OrchestratorState) -> str:
    """Post-orchestration routing: Maps state.route -> specialized agent or END."""
    route = state.get("route", "")
    if route == "ROUTE_FINANCE":
        return "financial_agent"
    elif route == "ROUTE_RAG":
        return "rag_agent"

    logger.warning(f"Unexpected route: {route}, defaulting to rag_agent")
    return "rag_agent"


def safety_to_orchestrate(state: OrchestratorState) -> str:
    """Safety-check routing: Logic for transitioning after the guardrail node."""
    if state.get("response") is not None:  # blocked by safety node
        return END
    return "hydrate_project"


# ---------------------------------------------------------------------------
# Build graph
# ---------------------------------------------------------------------------


def build_graph() -> Any:
    graph = StateGraph(OrchestratorState)

    graph.add_node("guardrail", guardrail_node)
    graph.add_node("hydrate_project", hydrate_project_node)
    graph.add_node("orchestrate", orchestrate_node)
    graph.add_node("financial_agent", financial_agent_node)
    graph.add_node("rag_agent", rag_agent_node)

    graph.set_entry_point("guardrail")

    graph.add_conditional_edges(
        "guardrail",
        safety_to_orchestrate,
        {END: END, "hydrate_project": "hydrate_project"},
    )
    graph.add_edge("hydrate_project", "orchestrate")
    graph.add_conditional_edges(
        "orchestrate",
        route_decision,
        {"financial_agent": "financial_agent", "rag_agent": "rag_agent"},
    )
    graph.add_edge("financial_agent", END)
    graph.add_edge("rag_agent", END)

    return graph.compile()


adu_graph = build_graph()
