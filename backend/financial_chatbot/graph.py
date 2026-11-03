"""LangGraph workflow for the finance consultant path."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any, TypedDict

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.graph import END, StateGraph
from pydantic import BaseModel, Field

from api.llm import STANDARD, astream_resilient, build_chat_llm
from api.rate_limiting.llm_pricing import (
    DEFAULT_REASONING_LEVEL,
    LITELLM_CHAT_MODEL,
    REASONING_MINIMAL,
    reasoning_kwargs,
)
from api.rate_limiting.llm_usage import (
    get_current_usage_accumulator,
    log_finance_turn_usage,
    record_langchain_usage,
    record_litellm_usage,
    record_serper_usage,
)
from api.utils import get_openrouter_key
from api.serper import fetch_serper_results, get_serper_api_key
from .citations import StreamingCitationNormalizer
from .config import (
    CONSULTANT_RESEARCH_PLANNER_PROMPT,
    CONSULTANT_ROUTE,
    CONSULTANT_SOURCE_RELEVANCE_PROMPT,
    FINANCE_MODEL,
    MAX_CONSULTANT_SEARCHES,
    MAX_SEARCH_RESULTS,
    SOURCE_RELEVANCE_SNIPPET_CHARS,
    SUGGESTED_QUESTIONS_PROMPT,
)
from .context import (
    append_unique_source,
    build_agent_context,
    build_consultant_complication_context,
    build_consultant_synthesis_instructions,
    build_follow_up_context,
    normalize_web_search_source,
)
from .schemas import (
    ChatMessage,
    FinancePresentationInput,
    FinanceStateSnapshot,
    FinanceSuggestedQuestionsOutput,
    FinancialChatStreamEvent,
)

logger = logging.getLogger(__name__)

PLANNING_STAGE = "Planning research..."
SEARCH_STAGE = "Searching the web..."
ANSWER_STAGE = "Writing answer..."
FOLLOW_UP_STAGE = "Generating follow-up ideas..."


class FinanceResearchPlan(BaseModel):
    queries: list[str] = Field(default_factory=list)


class SourceRelevanceDecision(BaseModel):
    index: int
    keep: bool


class SourceRelevanceVerdict(BaseModel):
    decisions: list[SourceRelevanceDecision] = Field(default_factory=list)


class FinanceConsultantState(TypedDict, total=False):
    message: str
    history: list[ChatMessage]
    answer_safe_context: str | None
    finance_state: FinanceStateSnapshot
    presentation: FinancePresentationInput
    search_queries: list[str]
    sources: list[dict[str, Any]]
    research_summary: str
    answer: str
    suggested_questions: list[str]


@dataclass
class FinanceConsultantGraphResult:
    answer: str
    sources: list[dict[str, Any]]
    suggested_questions: list[str]
    research_summary: str


def build_graph() -> Any:
    graph = StateGraph(FinanceConsultantState)
    graph.add_node("research", research_node)
    graph.add_node("filter_sources", filter_sources_node)
    graph.add_node("generate_answer", generate_answer_node)
    graph.add_node("generate_follow_ups", generate_follow_ups_node)

    graph.set_entry_point("research")
    graph.add_edge("research", "filter_sources")
    graph.add_edge("filter_sources", "generate_answer")
    graph.add_edge("generate_answer", "generate_follow_ups")
    graph.add_edge("generate_follow_ups", END)
    return graph.compile()


_compiled_graph = None


def get_compiled_graph():
    global _compiled_graph
    if _compiled_graph is None:
        _compiled_graph = build_graph()
    return _compiled_graph


async def run_finance_consultant_graph(
    *,
    message: str,
    history: list[ChatMessage],
    answer_safe_context: str | None,
    finance_state: FinanceStateSnapshot,
    presentation: FinancePresentationInput,
) -> FinanceConsultantGraphResult:
    accumulator = get_current_usage_accumulator()
    usage_baseline = accumulator.breakdown_count() if accumulator is not None else 0
    graph = get_compiled_graph()
    result = await graph.ainvoke(
        {
            "message": message,
            "history": history,
            "answer_safe_context": answer_safe_context,
            "finance_state": finance_state,
            "presentation": presentation,
            "search_queries": [],
            "sources": [],
            "research_summary": "",
            "answer": "",
            "suggested_questions": [],
        }
    )
    log_finance_turn_usage(prompt=message, since=usage_baseline)
    return FinanceConsultantGraphResult(
        answer=result.get("answer", "").strip(),
        sources=result.get("sources", []),
        suggested_questions=result.get("suggested_questions", []),
        research_summary=result.get("research_summary", "").strip(),
    )


async def stream_finance_consultant_graph(
    *,
    message: str,
    history: list[ChatMessage],
    answer_safe_context: str | None,
    finance_state: FinanceStateSnapshot,
    presentation: FinancePresentationInput,
) -> AsyncIterator[FinancialChatStreamEvent]:
    accumulator = get_current_usage_accumulator()
    usage_baseline = accumulator.breakdown_count() if accumulator is not None else 0
    state: FinanceConsultantState = {
        "message": message,
        "history": history,
        "answer_safe_context": answer_safe_context,
        "finance_state": finance_state,
        "presentation": presentation,
        "search_queries": [],
        "sources": [],
        "research_summary": "",
        "answer": "",
        "suggested_questions": [],
    }

    yield FinancialChatStreamEvent("status", PLANNING_STAGE)
    search_queries = await plan_research_queries(state)
    state = {**state, "search_queries": search_queries}

    yield FinancialChatStreamEvent("status", SEARCH_STAGE)
    state = await search_web_node(state)
    state = await filter_sources_node(state)

    yield FinancialChatStreamEvent("status", ANSWER_STAGE)
    citation_normalizer = StreamingCitationNormalizer(
        total_sources=len(state.get("sources", []))
    )
    normalized_answer_chunks: list[str] = []
    async for raw_chunk in stream_answer_text(state):
        normalized_chunk = citation_normalizer.consume(raw_chunk)
        if not normalized_chunk:
            continue
        normalized_answer_chunks.append(normalized_chunk)
        yield FinancialChatStreamEvent("text", normalized_chunk)

    final_chunk = citation_normalizer.finalize()
    if final_chunk:
        normalized_answer_chunks.append(final_chunk)
        yield FinancialChatStreamEvent("text", final_chunk)

    answer = "".join(normalized_answer_chunks).strip()
    normalized_sources = citation_normalizer.build_ordered_sources(
        state.get("sources", [])
    )
    state = {**state, "answer": answer, "sources": normalized_sources}

    yield FinancialChatStreamEvent("sources", normalized_sources)

    yield FinancialChatStreamEvent("status", FOLLOW_UP_STAGE)
    state = await generate_follow_ups_node(state)

    result = FinanceConsultantGraphResult(
        answer=state.get("answer", "").strip(),
        sources=state.get("sources", []),
        suggested_questions=state.get("suggested_questions", []),
        research_summary=state.get("research_summary", "").strip(),
    )
    yield FinancialChatStreamEvent("suggested_questions", result.suggested_questions)
    log_finance_turn_usage(prompt=message, since=usage_baseline)
    yield FinancialChatStreamEvent("result", result)


async def research_node(state: FinanceConsultantState) -> FinanceConsultantState:
    search_queries = await plan_research_queries(state)
    return await search_web_node({**state, "search_queries": search_queries})


async def plan_research_queries(state: FinanceConsultantState) -> list[str]:
    planner = build_finance_structured_llm(
        FinanceResearchPlan, include_raw=True, level=REASONING_MINIMAL
    )
    prompt = build_research_planner_prompt(state)
    result = await planner.ainvoke(prompt)
    raw_message = result.get("raw")
    if raw_message is not None:
        record_langchain_usage(
            raw_message=raw_message,
            route="finance",
            source="finance.plan_research",
            model=FINANCE_MODEL,
        )
    parsed = result.get("parsed")
    return select_search_queries(parsed.queries if parsed else [], state["message"])


async def search_web_node(state: FinanceConsultantState) -> FinanceConsultantState:
    serper_key = get_serper_api_key()
    if not serper_key:
        logger.warning(
            "SERPER_API_KEY not set — finance web search skipped. "
            "The consultant will answer without web evidence."
        )
        return {**state, "sources": []}

    results_by_query = await fetch_serper_results(
        api_key=serper_key,
        queries=state.get("search_queries", []),
        num_results=MAX_SEARCH_RESULTS,
    )
    # Charge per query Serper actually answered: fetch_serper_results drops
    # failed sub-queries, which Serper does not bill, so counting the
    # responses reconciles against the Serper dashboard.
    record_serper_usage(
        num_calls=len(results_by_query),
        route="finance",
        source="finance.web_search",
    )
    sources = collect_sources_from_queries(results_by_query)
    return {**state, "sources": sources}


def collect_sources_from_queries(
    query_results: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    sources: list[dict[str, Any]] = []
    for result in query_results:
        collect_search_sources(sources, result.get("results", []))
    return sources


async def filter_sources_node(state: FinanceConsultantState) -> FinanceConsultantState:
    return {**state, "sources": await filter_relevant_sources(state)}


async def filter_relevant_sources(
    state: FinanceConsultantState,
) -> list[dict[str, Any]]:
    sources = state.get("sources", [])
    if len(sources) <= 1:
        return sources
    prompt = build_source_relevance_prompt(state["message"], sources)
    try:
        verdict = await run_source_relevance_llm(prompt)
    except Exception:
        # Fail open: a relevance-call failure (e.g. an upstream 503) must not
        # abort the turn, so the answer step still receives the gathered
        # evidence instead of crashing before any answer is produced.
        logger.warning(
            "Source relevance filtering failed; passing all sources through.",
            exc_info=True,
        )
        return sources
    return apply_relevance_verdict(sources, verdict)


def build_source_relevance_prompt(message: str, sources: list[dict[str, Any]]) -> str:
    listed: list[str] = []
    for index, source in enumerate(sources, start=1):
        title = source.get("source") or "Untitled result"
        snippet = (source.get("chunk_text") or "").strip()[
            :SOURCE_RELEVANCE_SNIPPET_CHARS
        ]
        listed.append(f"[{index}] {title}\n{snippet}")
    return (
        f"{CONSULTANT_SOURCE_RELEVANCE_PROMPT}\n\n"
        f"User question:\n{message}\n\n"
        f"Candidate sources:\n{'\n---\n'.join(listed)}"
    )


async def run_source_relevance_llm(prompt: str) -> SourceRelevanceVerdict | None:
    checker = build_finance_structured_llm(
        SourceRelevanceVerdict, include_raw=True, level=REASONING_MINIMAL
    )
    result = await checker.ainvoke(prompt)
    raw_message = result.get("raw")
    if raw_message is not None:
        record_langchain_usage(
            raw_message=raw_message,
            route="finance",
            source="finance.filter_sources",
            model=FINANCE_MODEL,
        )
    return result.get("parsed")


def apply_relevance_verdict(
    sources: list[dict[str, Any]],
    verdict: SourceRelevanceVerdict | None,
) -> list[dict[str, Any]]:
    if verdict is None:
        return sources
    keep_by_index = {decision.index: decision.keep for decision in verdict.decisions}
    kept = [
        source
        for position, source in enumerate(sources, start=1)
        if keep_by_index.get(position, True)
    ]
    # Fail open: a filter that would discard every source is treated as a
    # misfire, so the synthesis step still receives the gathered evidence.
    if not kept:
        return sources
    return kept


async def generate_answer_node(state: FinanceConsultantState) -> FinanceConsultantState:
    answer = await generate_answer_text(state)
    return {**state, "answer": answer}


async def generate_follow_ups_node(
    state: FinanceConsultantState,
) -> FinanceConsultantState:
    llm = build_finance_structured_llm(
        FinanceSuggestedQuestionsOutput, include_raw=True
    )
    prompt = build_follow_up_prompt(state)
    result = await llm.ainvoke(prompt)
    raw_message = result.get("raw")
    if raw_message is not None:
        record_langchain_usage(
            raw_message=raw_message,
            route="finance",
            source="finance.followups",
            model=FINANCE_MODEL,
        )
    parsed = result.get("parsed")
    questions = [
        question.strip()
        for question in (parsed.questions if parsed else [])
        if question.strip()
    ]
    return {**state, "suggested_questions": questions[:4]}


def build_finance_llm(level: str = DEFAULT_REASONING_LEVEL) -> ChatOpenAI:
    return build_chat_llm(tier=STANDARD, reasoning_level=level)


def build_finance_structured_llm(
    schema: type[BaseModel],
    *,
    include_raw: bool = False,
    level: str = DEFAULT_REASONING_LEVEL,
):
    return build_finance_llm(level).with_structured_output(
        schema, include_raw=include_raw
    )


def build_prompt_messages(*, system_instruction: str, user_content: str) -> list:
    return [
        SystemMessage(content=system_instruction),
        HumanMessage(content=user_content),
    ]


async def generate_answer_text(state: FinanceConsultantState) -> str:
    llm = build_finance_llm()
    messages = build_prompt_messages(**build_answer_prompt(state))
    result = await llm.ainvoke(messages)
    record_langchain_usage(
        raw_message=result,
        route="finance",
        source="finance.answer",
        model=FINANCE_MODEL,
    )
    return extract_text(result)


async def stream_answer_text(state: FinanceConsultantState) -> AsyncIterator[str]:
    api_key = get_openrouter_key()
    if not api_key:
        raise RuntimeError("OPENROUTER_API_KEY is required for the finance chatbot.")

    answer_prompt = build_answer_prompt(state)
    response = astream_resilient(
        tier=STANDARD,
        model=LITELLM_CHAT_MODEL,
        api_key=api_key,
        messages=[
            {"role": "system", "content": answer_prompt["system_instruction"]},
            {"role": "user", "content": answer_prompt["user_content"]},
        ],
        stream_options={"include_usage": True},
        **reasoning_kwargs(),
    )

    streamed_usage = None
    async for chunk in response:
        usage = getattr(chunk, "usage", None)
        if usage is not None:
            streamed_usage = usage
        choices = getattr(chunk, "choices", None) or []
        if not choices:
            continue
        delta = getattr(choices[0], "delta", None)
        content = getattr(delta, "content", None)
        if content:
            yield content

    # ponytail: static estimate instead of the actual-cost fetch — the
    # synchronous reconcile added ~2.5-5s after the stream ended. Restore
    # record_openrouter_generation_cost (llm_usage.py) if billed accuracy
    # matters again; background reconcile is the no-delay upgrade path.
    record_litellm_usage(
        model=FINANCE_MODEL,
        usage=streamed_usage,
        route="finance",
        source="finance.stream_answer",
    )


def build_research_planner_prompt(state: FinanceConsultantState) -> str:
    return f"{CONSULTANT_RESEARCH_PLANNER_PROMPT}\n\n{build_llm_context(state)}"


def build_answer_prompt(state: FinanceConsultantState) -> dict[str, str]:
    return {
        "system_instruction": build_consultant_synthesis_instructions(
            sources=state.get("sources", []),
            research_summary=state.get("research_summary", ""),
        ),
        "user_content": build_llm_context(state),
    }


def build_follow_up_prompt(state: FinanceConsultantState) -> str:
    return (
        f"{SUGGESTED_QUESTIONS_PROMPT}\n\n"
        f"{
            build_follow_up_context(
                message=state['message'],
                answer=state.get('answer', ''),
                route=CONSULTANT_ROUTE,
                history=state.get('history', []),
                finance_state=state['finance_state'],
                presentation=state['presentation'],
            )
        }"
    )


def build_llm_context(state: FinanceConsultantState) -> str:
    return build_agent_context(
        message=state["message"],
        history=state.get("history", []),
        finance_state=state["finance_state"],
        presentation=state["presentation"],
        answer_safe_context=state.get("answer_safe_context"),
        complication_context=build_consultant_complication_context(
            finance_state=state["finance_state"],
            message=state["message"],
        ),
    )


def select_search_queries(planned_queries: list[str], message: str) -> list[str]:
    normalized_queries: list[str] = []
    for query in planned_queries:
        cleaned_query = normalize_query(query)
        if not cleaned_query or cleaned_query in normalized_queries:
            continue
        normalized_queries.append(cleaned_query)
        if len(normalized_queries) == MAX_CONSULTANT_SEARCHES:
            return normalized_queries

    fallback_query = normalize_query(message)
    if fallback_query and fallback_query not in normalized_queries:
        normalized_queries.append(fallback_query)
    return normalized_queries[:MAX_CONSULTANT_SEARCHES]


def normalize_query(query: str) -> str:
    return " ".join(query.split()).strip()


def collect_search_sources(
    collected_sources: list[dict[str, Any]],
    results: list[dict[str, Any]],
) -> None:
    for result in results:
        content = (result.get("content") or "").strip()
        if not content:
            continue
        append_unique_source(collected_sources, normalize_web_search_source(result))


def extract_text(result: Any) -> str:
    content = getattr(result, "content", result)
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict):
                text = item.get("text")
                if text:
                    parts.append(str(text))
                continue
            text = getattr(item, "text", None)
            if text:
                parts.append(str(text))
        return "\n".join(parts).strip()
    return str(content).strip()
