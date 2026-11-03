"""Retrieve and validate trusted local ADU evidence from Serper."""

from __future__ import annotations

import logging
from collections.abc import Mapping
from urllib.parse import urlparse

from langchain_core.documents import Document

from api.llm import FAST, build_chat_llm
from api.rate_limiting.llm_pricing import CHAT_COMPLETION_MODEL, REASONING_MINIMAL
from api.rate_limiting.llm_usage import record_langchain_usage, record_serper_usage
from api.serper import fetch_serper_results, get_serper_api_key
from api.utils import get_openrouter_key
from RAG_pipeline.schemas import (
    GraphState,
    WebSourceAssessment,
    _WEB_SOURCE_PROMPT,
)

logger = logging.getLogger(__name__)

MAX_WEB_SEARCH_QUERIES = 2
WEB_RESULTS_PER_QUERY = 5


def _is_official_url(url: str) -> bool:
    hostname = (urlparse(url).hostname or "").lower()
    return hostname == "gov" or hostname.endswith(".gov")


def _search_queries(state: GraphState) -> list[str]:
    primary_query = state.get("web_search_query") or (
        f"California ADU regulations: {state['question']}"
    )
    secondary_query = (
        f"{primary_query} planning building department official requirements"
    )
    return list(dict.fromkeys((primary_query, secondary_query)))[
        :MAX_WEB_SEARCH_QUERIES
    ]


def _merge_results(responses: list[dict]) -> list[dict]:
    merged: list[dict] = []
    seen: set[str] = set()
    for response in responses:
        for result in response.get("results", []):
            key = str(result.get("url") or result.get("content") or "")
            if not key or key in seen:
                continue
            seen.add(key)
            merged.append(result)
    return merged


def _format_candidates(results: list[dict]) -> str:
    parts = []
    for number, result in enumerate(results, start=1):
        parts.append(
            "\n".join(
                (
                    f"[{number}]",
                    f"Title: {result.get('title') or 'Untitled'}",
                    f"URL: {result.get('url') or 'Unknown'}",
                    f"Snippet: {result.get('content') or ''}",
                )
            )
        )
    return "\n\n".join(parts)


def _official_source_decisions(results: list[dict]) -> dict[int, str]:
    return {
        number: "official"
        for number, result in enumerate(results, start=1)
        if _is_official_url(str(result.get("url") or ""))
    }


async def _assess_sources(*, search_query: str, results: list[dict]) -> dict[int, str]:
    api_key = get_openrouter_key()
    if not api_key:
        return _official_source_decisions(results)

    try:
        llm = build_chat_llm(
            tier=FAST,
            api_key=api_key,
            max_output_tokens=300,
            structured_output=WebSourceAssessment,
            include_raw=True,
            reasoning_level=REASONING_MINIMAL,
        )
        response = await llm.ainvoke(
            _WEB_SOURCE_PROMPT.format(
                search_query=search_query,
                results=_format_candidates(results),
            )
        )
        raw_message = response.get("raw") if isinstance(response, Mapping) else None
        if raw_message is not None:
            record_langchain_usage(
                raw_message=raw_message,
                route="rag",
                source="rag.web_source_assessor",
                model=CHAT_COMPLETION_MODEL,
            )
        parsed = response.get("parsed") if isinstance(response, Mapping) else None
        if not isinstance(parsed, WebSourceAssessment):
            raise ValueError("Web source assessor returned no parsed result")
        valid_numbers = range(1, len(results) + 1)
        return {
            decision.source_number: decision.authority
            for decision in parsed.accepted_sources
            if decision.source_number in valid_numbers
        }
    except Exception as exc:
        logger.warning(
            "Web source assessment failed; retaining official sources only: %s",
            exc,
        )
        return _official_source_decisions(results)


def _to_documents(
    results: list[dict],
    accepted_sources: dict[int, str],
) -> list[Document]:
    accepted = [
        (number, result)
        for number, result in enumerate(results, start=1)
        if number in accepted_sources and result.get("content")
    ]
    accepted.sort(key=lambda item: accepted_sources[item[0]] != "official")
    return [
        Document(
            page_content=result["content"],
            metadata={
                "source": "web_search",
                "url": result.get("url") or "",
                "regulation_topic": result.get("title") or "Local ADU guidance",
                "authority": accepted_sources[number],
            },
        )
        for number, result in accepted
    ]


async def web_search_node(state: GraphState) -> GraphState:
    """Search Serper and append only trusted, relevant result snippets."""
    serper_key = get_serper_api_key()
    if not serper_key:
        logger.warning("SERPER_API_KEY not set; local web evidence unavailable")
        state["web_search_status"] = "unavailable"
        return state

    search_queries = _search_queries(state)
    try:
        responses = await fetch_serper_results(
            api_key=serper_key,
            queries=search_queries,
            num_results=WEB_RESULTS_PER_QUERY,
        )
        # Charge per query Serper actually answered: fetch_serper_results drops
        # failed sub-queries, which Serper does not bill, so counting the
        # responses reconciles against the Serper dashboard.
        record_serper_usage(
            num_calls=len(responses),
            route="rag",
            source="rag.web_search",
        )
        results = _merge_results(responses)
        if not results:
            state["web_search_status"] = "no_trusted_results"
            logger.info("Web search returned no results")
            return state
        accepted_sources = await _assess_sources(
            search_query="\n".join(search_queries),
            results=results,
        )
        web_documents = _to_documents(results, accepted_sources)
        state["documents"] = state.get("documents", []) + web_documents
        state["web_search_status"] = (
            "succeeded" if web_documents else "no_trusted_results"
        )
        logger.info(
            "Web search accepted %d of %d unique results from %d queries",
            len(web_documents),
            len(results),
            len(search_queries),
        )
    except Exception as exc:
        logger.error("Web search failed: %s", exc)
        state["web_search_status"] = "failed"

    return state
