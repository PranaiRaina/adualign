import os
from contextlib import asynccontextmanager, contextmanager
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

os.environ.setdefault("SUPABASE_DATABASE_URL", "sqlite:///./test-error-sanitization.db")

import RAG_pipeline.router as rag_router
import api.main as api_main
import financial_chatbot.router as financial_router
import orchestrator.router as orchestrator_router
from api.chat_guardrails import allow_result
from api.database.schemas import ProjectCreate
from api.routers import reports as reports_router
from orchestrator.schemas import OrchestratorRequest
from RAG_pipeline.schemas import ChatRequest as RagChatRequest
from financial_chatbot.schemas import CalculatorRequest


@asynccontextmanager
async def _noop_reserve_llm_budget(**kwargs):
    yield


@contextmanager
def _noop_usage_scope():
    yield


@pytest.mark.anyio
async def test_orchestrator_chat_sanitizes_internal_errors(monkeypatch):
    async def fake_ainvoke(state):
        raise RuntimeError("secret stack detail")

    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(
        orchestrator_router, "validate_orchestrator_request", lambda req: None
    )
    monkeypatch.setattr(orchestrator_router, "ensure_chat_api_key", lambda: None)
    monkeypatch.setattr(
        orchestrator_router,
        "ensure_project_access",
        lambda project_id, current_user_id: None,
    )
    monkeypatch.setattr(
        orchestrator_router, "ensure_user_api_key", lambda uid: "fake-hash"
    )
    monkeypatch.setattr(
        orchestrator_router, "reserve_llm_budget", _noop_reserve_llm_budget
    )
    monkeypatch.setattr(
        orchestrator_router, "usage_accumulator_scope", _noop_usage_scope
    )
    monkeypatch.setattr(orchestrator_router.adu_graph, "ainvoke", fake_ainvoke)

    with pytest.raises(HTTPException) as exc_info:
        await orchestrator_router.orchestrate_chat(
            OrchestratorRequest(message="Help with my ADU."),
            current_user=SimpleNamespace(id="user-123"),
        )

    assert exc_info.value.status_code == 502
    assert (
        exc_info.value.detail == "Unable to complete request. Please try again later."
    )


@pytest.mark.anyio
async def test_rag_chat_does_not_expose_env_diagnostics(monkeypatch):
    monkeypatch.setattr(rag_router, "get_secret", lambda name: None)
    monkeypatch.setattr(rag_router, "ensure_user_api_key", lambda uid: "fake-user-hash")

    with pytest.raises(HTTPException) as exc_info:
        await rag_router.chat(
            RagChatRequest(message="What is the ADU setback?"),
            current_user=SimpleNamespace(id="user-123"),
        )

    assert exc_info.value.status_code == 503
    assert exc_info.value.detail == "GEMINI_API_KEY not set."


@pytest.mark.anyio
async def test_rag_chat_requires_openrouter_key(monkeypatch):
    monkeypatch.setattr(
        rag_router,
        "get_secret",
        lambda name: "test-key" if name == "GEMINI_API_KEY" else None,
    )

    with pytest.raises(HTTPException) as exc_info:
        await rag_router.chat(
            RagChatRequest(message="What is the ADU setback?"),
            current_user=SimpleNamespace(id="user-123"),
        )

    assert exc_info.value.status_code == 503
    assert exc_info.value.detail == "OPENROUTER_API_KEY not set."


@pytest.mark.anyio
async def test_rag_chat_sanitizes_graph_failures(monkeypatch):
    class BrokenGraph:
        async def ainvoke(self, state):
            raise RuntimeError("internal retrieval trace")

    async def fake_guardrail(**kwargs):
        return allow_result()

    monkeypatch.setattr(rag_router, "get_secret", lambda name: "test-key")
    monkeypatch.setattr(rag_router, "ensure_user_api_key", lambda uid: "fake-user-hash")
    monkeypatch.setattr(rag_router, "reserve_llm_budget", _noop_reserve_llm_budget)
    monkeypatch.setattr(rag_router, "evaluate_guardrail_for_turns", fake_guardrail)
    monkeypatch.setattr(rag_router, "get_compiled_graph", lambda: BrokenGraph())

    with pytest.raises(HTTPException) as exc_info:
        await rag_router.chat(
            RagChatRequest(message="What is the ADU setback?"),
            current_user=SimpleNamespace(id="user-123"),
        )

    assert exc_info.value.status_code == 502
    assert (
        exc_info.value.detail == "Unable to complete request. Please try again later."
    )


@pytest.mark.anyio
async def test_rag_stream_sanitizes_internal_failures(monkeypatch):
    async def fake_guardrail(**kwargs):
        return allow_result().model_copy(
            update={
                "sanitized_message": "What is the ADU setback?",
                "sanitized_history": [],
            }
        )

    async def broken_grader_node(state):
        raise RuntimeError("internal retrieval trace")

    monkeypatch.setattr(rag_router, "get_secret", lambda name: "test-key")
    monkeypatch.setattr(rag_router, "ensure_user_api_key", lambda uid: "fake-user-hash")
    monkeypatch.setattr(rag_router, "reserve_llm_budget", _noop_reserve_llm_budget)
    monkeypatch.setattr(rag_router, "evaluate_guardrail_for_turns", fake_guardrail)
    monkeypatch.setattr(rag_router, "rephraser_node", lambda state: state)
    monkeypatch.setattr(rag_router, "retriever_node", lambda state: state)
    monkeypatch.setattr(rag_router, "grader_node", broken_grader_node)

    response = await rag_router.chat_stream(
        RagChatRequest(message="What is the ADU setback?"),
        current_user=SimpleNamespace(id="user-123"),
    )

    chunks: list[str] = []
    async for chunk in response.body_iterator:
        chunks.append(chunk if isinstance(chunk, str) else chunk.decode())

    body = "".join(chunks)
    assert (
        'data: {"text": "Unable to complete request. Please try again later."}' in body
    )
    assert "event: done" in body


@pytest.mark.anyio
async def test_finance_calculator_sanitizes_runtime_errors(monkeypatch):
    def fake_calculate_finance_snapshot(**kwargs):
        raise RuntimeError("internal pricing trace")

    monkeypatch.setattr(
        financial_router,
        "calculate_finance_snapshot",
        fake_calculate_finance_snapshot,
    )

    with pytest.raises(HTTPException) as exc_info:
        financial_router.calculator_endpoint(
            CalculatorRequest(county="Orange County", adu_sqft=600),
            current_user=SimpleNamespace(id="user-123"),
        )

    assert exc_info.value.status_code == 503
    assert (
        exc_info.value.detail == "Unable to complete request. Please try again later."
    )


def test_reports_create_project_sanitizes_internal_errors(monkeypatch):
    def fake_create_project(db, data, *, user_id):
        raise RuntimeError("db connection detail")

    monkeypatch.setattr(
        reports_router.ReportRepository, "create_project", fake_create_project
    )

    with pytest.raises(HTTPException) as exc_info:
        reports_router.create_project(
            ProjectCreate(),
            current_user=SimpleNamespace(id="user-123"),
            db=object(),
        )

    assert exc_info.value.status_code == 500
    assert (
        exc_info.value.detail == "Unable to complete request. Please try again later."
    )


@pytest.mark.anyio
async def test_partition_yards_sanitizes_internal_errors(monkeypatch):
    monkeypatch.setattr(api_main, "shape", lambda payload: "property-poly")
    monkeypatch.setattr(
        api_main,
        "partition_yards",
        lambda property_poly, front_lot_line, primary_structure: (_ for _ in ()).throw(
            RuntimeError("shapely internals")
        ),
    )

    request = SimpleNamespace(
        property_geojson=SimpleNamespace(type="Polygon", coordinates=[]),
        front_lot_line=[[0.0, 0.0], [1.0, 1.0]],
        primary_structure_geojson=None,
    )

    with pytest.raises(HTTPException) as exc_info:
        await api_main.partition_yards_endpoint(request)

    assert exc_info.value.status_code == 500
    assert (
        exc_info.value.detail == "Unable to complete request. Please try again later."
    )
