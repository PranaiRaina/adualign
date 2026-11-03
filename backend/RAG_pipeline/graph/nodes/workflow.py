"""
CRAG workflow — compiles the LangGraph StateGraph.

Graph flow:
  rephraser → retriever → grader → evidence → [web_search | generator] → END

The conditional edge from the evidence assessor checks ``run_web_search``:
  - True  → web_search → generator → END
  - False → generator → END
"""

from __future__ import annotations

import logging
from typing import Any

from langgraph.graph import END, StateGraph
from starlette.concurrency import run_in_threadpool

from RAG_pipeline.schemas import GraphState
from .rephraser import rephraser_node
from .retriever import retriever_node
from .grader import grader_node
from .evidence import evidence_assessor_node
from .web_search import web_search_node
from .generator import generator_node

logger = logging.getLogger(__name__)


def _should_web_search(state: GraphState) -> str:
    """Route to web search when evidence needs local supplementation."""
    if state.get("run_web_search", False):
        logger.info("Evidence assessor requested trusted local web search")
        return "web_search"
    return "generator"


async def retriever_node_threaded(state: GraphState) -> GraphState:
    return await run_in_threadpool(retriever_node, state)


def build_graph() -> Any:
    """Build and compile the CRAG StateGraph."""
    graph = StateGraph(GraphState)

    # Add nodes
    graph.add_node("rephraser", rephraser_node)
    graph.add_node("retriever", retriever_node_threaded)
    graph.add_node("grader", grader_node)
    graph.add_node("evidence", evidence_assessor_node)
    graph.add_node("web_search", web_search_node)
    graph.add_node("generator", generator_node)

    # Set entry point
    graph.set_entry_point("rephraser")

    # Add edges
    graph.add_edge("rephraser", "retriever")
    graph.add_edge("retriever", "grader")
    graph.add_edge("grader", "evidence")

    graph.add_conditional_edges(
        "evidence",
        _should_web_search,
        {
            "web_search": "web_search",
            "generator": "generator",
        },
    )

    graph.add_edge("web_search", "generator")
    graph.add_edge("generator", END)

    return graph.compile()


# Module-level compiled graph (lazy singleton)
_compiled_graph = None


def get_compiled_graph():
    """Return the compiled CRAG graph (singleton)."""
    global _compiled_graph
    if _compiled_graph is None:
        _compiled_graph = build_graph()
        logger.info("CRAG graph compiled successfully")
    return _compiled_graph
