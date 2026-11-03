"""
Rephraser node — contextualizes the user query for better retrieval.

Returns strict JSON ``{"query": "..."}`` to minimize generated tokens.
"""

from __future__ import annotations

import logging
from typing import Mapping

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
    RephraseResponse,
    _REPHRASE_PROMPT,
)
from RAG_pipeline.graph.nodes.evidence import (
    format_project_location,
    question_may_need_local_evidence,
)

logger = logging.getLogger(__name__)


@traceable(run_type="chain")
def rephraser_node(state: GraphState) -> GraphState:
    """Rephrase the user query for better retrieval."""
    question = state["question"]

    api_key = get_openrouter_key()
    if not api_key:
        logger.warning("No API key — skipping rephrasing")
        state["assess_local_evidence"] = question_may_need_local_evidence(state)
        return state

    try:
        # Use LangChain wrapper for automatic LangSmith token tracking
        structured_llm = build_chat_llm(
            tier=FAST,
            api_key=api_key,
            max_output_tokens=1000,
            structured_output=RephraseResponse,
            include_raw=True,
            reasoning_level=REASONING_MINIMAL,
        )

        result = structured_llm.invoke(
            _REPHRASE_PROMPT.format(
                project_location=format_project_location(state),
                question=question,
            )
        )
        if not isinstance(result, Mapping):
            state["assess_local_evidence"] = question_may_need_local_evidence(state)
            return state

        raw_message = result.get("raw")
        if raw_message is not None:
            record_langchain_usage(
                raw_message=raw_message,
                route="rag",
                source="rag.rephraser",
                model=CHAT_COMPLETION_MODEL,
            )
        parsed = result.get("parsed")

        rephrased = parsed.query.strip() if isinstance(parsed, RephraseResponse) else ""
        if isinstance(parsed, RephraseResponse):
            state["assess_local_evidence"] = parsed.assess_local_evidence
        else:
            state["assess_local_evidence"] = question_may_need_local_evidence(state)

        if rephrased and len(rephrased) > 5:
            logger.info("Rephrased: %r → %r", question, rephrased)
            state["question"] = rephrased

    except Exception as exc:
        logger.warning("Rephraser failed, using original query: %s", exc)
        state["assess_local_evidence"] = question_may_need_local_evidence(state)

    return state
