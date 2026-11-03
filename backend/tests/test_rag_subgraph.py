import pytest
from api.utils import get_api_key, get_openrouter_key
from orchestrator.schemas import OrchestratorRequest
from orchestrator.graph import build_graph

pytestmark = pytest.mark.skipif(
    not (get_openrouter_key() and get_api_key()),
    reason="Live RAG test; set OPENROUTER_API_KEY and GEMINI_API_KEY to run",
)


async def test_rag_subgraph_returns_response():
    graph = build_graph()

    req = OrchestratorRequest(
        message="What are the setbacks for a detached ADU?",
        address="123 Main St",
        adu_sqft=800,
    )

    state = await graph.ainvoke(
        {"request": req, "route": "ROUTE_RAG", "response": None}
    )

    response = state.get("response")
    assert response is not None, "RAG subgraph did not return a response"
    assert len(response.answer) > 0, "RAG subgraph returned an empty answer"
    assert len(response.sources) > 0, "RAG subgraph returned no sources"
