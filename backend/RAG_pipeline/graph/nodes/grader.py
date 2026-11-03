"""
Grader node — binary relevance grading of retrieved documents.

Uses deepseek-v4-flash (OpenRouter) with strict JSON output ``{"relevant": true/false}``
to minimize token generation. All grading calls fire in parallel via
``asyncio.gather`` so latency = max(single_call), not sum(all_calls).
"""

from __future__ import annotations

import asyncio
import logging

from langchain_core.documents import Document
from langsmith import traceable
from api.llm import FAST, build_chat_llm
from api.rate_limiting.llm_pricing import (
    CHAT_COMPLETION_MODEL,
    REASONING_MINIMAL,
)
from api.rate_limiting.llm_usage import record_langchain_usage
from api.utils import get_openrouter_key
from RAG_pipeline.schemas import (
    GraphState,
    GraderResponse,
    _GRADE_PROMPT,
)

logger = logging.getLogger(__name__)


@traceable(run_type="llm")
async def _grade_single(
    llm,  # ChatOpenAI.with_structured_output (json_schema)
    question: str,
    doc: Document,
) -> tuple[Document, bool]:
    """Grade a single document asynchronously. Returns (doc, is_relevant)."""
    try:
        prompt = _GRADE_PROMPT.format(
            question=question,
            document=doc.page_content[:2000],
        )

        # This will now report usage_metadata automatically to LangSmith
        result = await llm.ainvoke(prompt)
        raw_message = result.get("raw") if isinstance(result, dict) else None
        if raw_message is not None:
            record_langchain_usage(
                raw_message=raw_message,
                route="rag",
                source="rag.grader",
                model=CHAT_COMPLETION_MODEL,
            )
        parsed = result.get("parsed") if isinstance(result, dict) else None
        is_relevant = parsed.relevant if parsed else True

        if not is_relevant:
            logger.debug("Filtered out irrelevant chunk: %s...", doc.page_content[:80])
        return doc, is_relevant

    except Exception as exc:
        # Fail-open: keep the doc on grading failure
        logger.warning("Grading failed for a doc, keeping it: %s", exc)
        return doc, True


async def grader_node(state: GraphState) -> GraphState:
    """Grade all retrieved documents for relevance in parallel."""
    question = state["question"]
    documents = state.get("documents", [])

    if not documents:
        logger.info("No documents to grade — triggering web search")
        state["run_web_search"] = True
        return state

    api_key = get_openrouter_key()
    if not api_key:
        logger.warning("No API key — skipping grading, keeping all documents")
        state["run_web_search"] = False
        return state

    try:
        # Use LangChain wrapper for automatic LangSmith token tracking
        llm = build_chat_llm(
            tier=FAST,
            api_key=api_key,
            max_output_tokens=1000,
            structured_output=GraderResponse,
            include_raw=True,
            reasoning_level=REASONING_MINIMAL,
        )

        # Fire all grading calls in parallel
        tasks = [_grade_single(llm, question, doc) for doc in documents]
        results = await asyncio.gather(*tasks)

        relevant_docs = [doc for doc, is_relevant in results if is_relevant]

        logger.info(
            "Parallel grading complete: %d/%d documents passed",
            len(relevant_docs),
            len(documents),
        )

        state["documents"] = relevant_docs
        state["run_web_search"] = len(relevant_docs) == 0

    except Exception as exc:
        logger.error("Grader node failed entirely: %s", exc)
        state["run_web_search"] = False

    return state
