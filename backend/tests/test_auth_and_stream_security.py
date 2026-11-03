from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import cast

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import HTTPException
from langchain_core.documents import Document

import RAG_pipeline.router as rag_router
import api.authentication.auth as auth
import api.authentication.supabase_auth as supabase_auth
import financial_chatbot.reporting as financial_reporting
import financial_chatbot.router as financial_router
import orchestrator.graph as orchestrator_graph
import orchestrator.consolidator as orchestrator_consolidator
import orchestrator.router as orchestrator_router
from api.chat_guardrails import allow_result
from api.database import core as db_core
from api.database.schemas import ProjectCreate, ProjectUpdate
from api.database.models import User
from api.database.repository import ReportRepository
from api.rate_limiting.llm_usage import LLMUsageAccumulator, usage_accumulator_scope
from api.routers import reports as reports_router
from financial_chatbot.schemas import (
    CalculatorRequest,
    EstimateRange,
    FinanceStateSnapshot,
)
from RAG_pipeline.schemas import ChatRequest as RagChatRequest
from api.errors import GENERIC_ERROR_MESSAGE
from orchestrator.schemas import OrchestratorRequest


class FakeSession:
    def __enter__(self):
        return object()

    def __exit__(self, exc_type, exc, tb):
        return False


TEST_USER = cast(User, SimpleNamespace(id="user-123"))


def build_hs256_token(secret: str, issuer: str) -> str:
    return jwt.encode(
        {
            "sub": "user-123",
            "email": "user@example.com",
            "user_metadata": {"name": "Casey"},
            "iss": issuer,
            "exp": int((datetime.now(timezone.utc) + timedelta(minutes=5)).timestamp()),
        },
        secret,
        algorithm="HS256",
    )


def reset_auth_caches() -> None:
    supabase_auth.load_supabase_auth_settings.cache_clear()
    supabase_auth.load_jwks_client.cache_clear()


def test_verify_supabase_access_token_accepts_signed_hs256(monkeypatch):
    monkeypatch.setenv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co")
    monkeypatch.setenv(
        "SUPABASE_JWT_SECRET",
        "correct-secret-correct-secret-1234",
    )
    reset_auth_caches()

    claims = supabase_auth.verify_supabase_access_token(
        build_hs256_token(
            secret="correct-secret-correct-secret-1234",
            issuer="https://project.supabase.co/auth/v1",
        )
    )

    assert claims.user_id == "user-123"
    assert claims.email == "user@example.com"
    assert claims.user_metadata == {"name": "Casey"}


def test_verify_supabase_access_token_rejects_wrong_signature(monkeypatch):
    monkeypatch.setenv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co")
    monkeypatch.setenv(
        "SUPABASE_JWT_SECRET",
        "correct-secret-correct-secret-1234",
    )
    reset_auth_caches()

    forged_token = build_hs256_token(
        secret="wrong-secret-wrong-secret-987654",
        issuer="https://project.supabase.co/auth/v1",
    )

    with pytest.raises(supabase_auth.SupabaseTokenVerificationError):
        supabase_auth.verify_supabase_access_token(forged_token)


def test_verify_supabase_access_token_accepts_signed_es256(monkeypatch):
    private_key = ec.generate_private_key(ec.SECP256R1())
    public_key = private_key.public_key()
    token = jwt.encode(
        {
            "sub": "user-123",
            "email": "user@example.com",
            "user_metadata": {"name": "Casey"},
            "iss": "https://project.supabase.co/auth/v1",
            "exp": int((datetime.now(timezone.utc) + timedelta(minutes=5)).timestamp()),
        },
        private_key,
        algorithm="ES256",
    )

    monkeypatch.setenv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co")
    reset_auth_caches()
    monkeypatch.setattr(
        supabase_auth,
        "load_jwks_client",
        lambda: SimpleNamespace(
            get_signing_key_from_jwt=lambda jwt_token: SimpleNamespace(key=public_key)
        ),
    )

    claims = supabase_auth.verify_supabase_access_token(token)

    assert claims.user_id == "user-123"
    assert claims.email == "user@example.com"
    assert claims.user_metadata == {"name": "Casey"}


def test_optional_auth_header_ignores_invalid_token(monkeypatch):
    monkeypatch.setattr(
        auth,
        "resolve_current_user_from_token",
        lambda token, db: (_ for _ in ()).throw(
            HTTPException(status_code=401, detail="Could not validate credentials")
        ),
    )

    user = auth.get_user_from_authorization_header(
        "Bearer stale-token",
        object(),
        required=False,
    )

    assert user is None


@pytest.mark.anyio
async def test_rag_chat_requires_authenticated_user():
    with pytest.raises(HTTPException) as exc_info:
        await rag_router.chat(
            RagChatRequest(message="Can I build an ADU in my backyard?"),
            current_user=None,
        )

    assert exc_info.value.status_code == 401


@pytest.mark.anyio
async def test_rag_stream_requires_authenticated_user():
    with pytest.raises(HTTPException) as exc_info:
        await rag_router.chat_stream(
            RagChatRequest(message="Can I build an ADU in my backyard?"),
            current_user=None,
        )

    assert exc_info.value.status_code == 401


@pytest.mark.anyio
@pytest.mark.parametrize("failing_route", ["guardrail", "rag"])
async def test_rag_chat_raises_429_before_graph_when_budget_exceeded(
    monkeypatch,
    failing_route: str,
):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")

    @asynccontextmanager
    async def fake_reserve_llm_budget(**kwargs):
        if kwargs["route"] == failing_route:
            raise HTTPException(status_code=429, detail="Cost budget exceeded.")
        yield SimpleNamespace(stream_terminated_early=False)

    async def fake_guardrail(**kwargs):
        return allow_result().model_copy(
            update={
                "sanitized_message": "Can I build an ADU in my backyard?",
                "sanitized_history": [],
            }
        )

    def fail_if_called():
        raise AssertionError("RAG graph should not run when the budget is exceeded")

    monkeypatch.setattr(rag_router, "get_secret", lambda name: "test-key")
    monkeypatch.setattr(rag_router, "ensure_user_api_key", lambda uid: "fake-user-hash")
    monkeypatch.setattr(rag_router, "reserve_llm_budget", fake_reserve_llm_budget)
    monkeypatch.setattr(rag_router, "evaluate_guardrail_for_turns", fake_guardrail)
    monkeypatch.setattr(rag_router, "get_compiled_graph", fail_if_called)

    with pytest.raises(HTTPException) as exc_info:
        await rag_router.chat(
            RagChatRequest(message="Can I build an ADU in my backyard?"),
            current_user=TEST_USER,
        )

    assert exc_info.value.status_code == 429


@pytest.mark.anyio
@pytest.mark.parametrize("failing_route", ["guardrail", "rag"])
async def test_rag_stream_raises_429_before_starting_sse(
    monkeypatch,
    failing_route: str,
):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")

    @asynccontextmanager
    async def fake_reserve_llm_budget(**kwargs):
        if kwargs["route"] == failing_route:
            raise HTTPException(status_code=429, detail="Cost budget exceeded.")
        yield SimpleNamespace(stream_terminated_early=False)

    async def fake_guardrail(**kwargs):
        return allow_result().model_copy(
            update={
                "sanitized_message": "What are my ADU setback options?",
                "sanitized_history": [],
            }
        )

    monkeypatch.setattr(rag_router, "get_secret", lambda name: "test-key")
    monkeypatch.setattr(rag_router, "ensure_user_api_key", lambda uid: "fake-user-hash")
    monkeypatch.setattr(rag_router, "reserve_llm_budget", fake_reserve_llm_budget)
    monkeypatch.setattr(rag_router, "evaluate_guardrail_for_turns", fake_guardrail)

    with pytest.raises(HTTPException) as exc_info:
        await rag_router.chat_stream(
            RagChatRequest(message="What are my ADU setback options?"),
            current_user=TEST_USER,
        )

    assert exc_info.value.status_code == 429


@pytest.mark.anyio
async def test_rag_chat_returns_sources_and_suggested_questions_when_allowed(
    monkeypatch,
):
    reserve_calls: list[tuple[str, str]] = []

    class FakeGraph:
        async def ainvoke(self, state):
            assert state["original_question"] == "Can I build a detached ADU?"
            return {
                "generation": "You can usually build a detached ADU. [1]",
                "documents": [
                    Document(
                        page_content="Detached ADUs are generally allowed on residential lots.",
                        metadata={
                            "id": "doc-1",
                            "source": "adu_handbook",
                            "page_number": 12,
                            "regulation_topic": "general",
                        },
                    )
                ],
            }

    @asynccontextmanager
    async def fake_reserve_llm_budget(**kwargs):
        reserve_calls.append((kwargs["route"], kwargs["api_key_hash"]))
        yield SimpleNamespace(stream_terminated_early=False)

    async def fake_guardrail(**kwargs):
        return allow_result().model_copy(
            update={
                "sanitized_message": "Can I build a detached ADU?",
                "sanitized_history": [],
            }
        )

    async def fake_generate_suggested_questions(question: str, answer: str):
        return ["What about setbacks?"]

    monkeypatch.setattr(rag_router, "get_secret", lambda name: "test-key")
    monkeypatch.setattr(rag_router, "ensure_user_api_key", lambda uid: "fake-user-hash")
    monkeypatch.setattr(rag_router, "reserve_llm_budget", fake_reserve_llm_budget)
    monkeypatch.setattr(rag_router, "evaluate_guardrail_for_turns", fake_guardrail)
    monkeypatch.setattr(rag_router, "get_compiled_graph", lambda: FakeGraph())
    monkeypatch.setattr(
        rag_router,
        "generate_suggested_questions",
        fake_generate_suggested_questions,
    )

    response = await rag_router.chat(
        RagChatRequest(message="Can I build a detached ADU?"),
        current_user=TEST_USER,
    )

    assert response.answer == "You can usually build a detached ADU. [1]"
    assert response.suggested_questions == ["What about setbacks?"]
    assert reserve_calls == [
        ("guardrail", "fake-user-hash"),
        ("rag", "fake-user-hash"),
    ]
    assert response.sources == [
        {
            "page_number": 12,
            "source": "adu_handbook",
            "regulation_topic": "general",
            "chunk_text": "Detached ADUs are generally allowed on residential lots.",
            "url": None,
            "citation_url": "/adu-handbook.pdf",
        }
    ]


@pytest.mark.anyio
async def test_rag_stream_response_includes_sources_and_suggested_questions(
    monkeypatch,
):
    reserve_calls: list[tuple[str, str]] = []

    @asynccontextmanager
    async def fake_reserve_llm_budget(**kwargs):
        reserve_calls.append((kwargs["route"], kwargs["api_key_hash"]))
        yield SimpleNamespace(stream_terminated_early=False)

    async def fake_guardrail(**kwargs):
        return allow_result().model_copy(
            update={
                "sanitized_message": "What ADU setbacks apply?",
                "sanitized_history": [],
            }
        )

    async def fake_grader_node(state):
        return state

    async def fake_stream_generation(question, documents, frontend_context):
        yield "Setbacks vary by lot. "
        yield "Check your local handbook. [1]"

    async def fake_generate_suggested_questions(question: str, answer: str):
        return ["How do I verify my lot?"]

    monkeypatch.setattr(rag_router, "get_secret", lambda name: "test-key")
    monkeypatch.setattr(rag_router, "ensure_user_api_key", lambda uid: "fake-user-hash")
    monkeypatch.setattr(rag_router, "reserve_llm_budget", fake_reserve_llm_budget)
    monkeypatch.setattr(rag_router, "evaluate_guardrail_for_turns", fake_guardrail)
    monkeypatch.setattr(rag_router, "rephraser_node", lambda state: state)
    monkeypatch.setattr(
        rag_router,
        "retriever_node",
        lambda state: {
            **state,
            "documents": [
                Document(
                    page_content="Rear setbacks often depend on local zoning overlays.",
                    metadata={
                        "id": "doc-1",
                        "source": "adu_handbook",
                        "page_number": 44,
                        "regulation_topic": "setbacks",
                    },
                )
            ],
        },
    )
    monkeypatch.setattr(rag_router, "grader_node", fake_grader_node)
    monkeypatch.setattr(rag_router, "evidence_assessor_node", fake_grader_node)
    monkeypatch.setattr(rag_router, "stream_generation", fake_stream_generation)
    monkeypatch.setattr(
        rag_router,
        "generate_suggested_questions",
        fake_generate_suggested_questions,
    )

    response = await rag_router.chat_stream(
        RagChatRequest(message="What ADU setbacks apply?"),
        current_user=TEST_USER,
    )

    chunks: list[str] = []
    async for chunk in response.body_iterator:
        chunks.append(chunk if isinstance(chunk, str) else chunk.decode())

    body = "".join(chunks)
    assert reserve_calls == [
        ("guardrail", "fake-user-hash"),
        ("rag", "fake-user-hash"),
    ]
    assert (
        'event: sources\ndata: [{"page_number": 44, "source": "adu_handbook", "regulation_topic": "setbacks", "chunk_text": "Rear setbacks often depend on local zoning overlays.", "url": null, "citation_url": "/adu-handbook.pdf"}]'
        in body
    )
    assert 'event: suggested_questions\ndata: ["How do I verify my lot?"]' in body
    assert "event: done" in body


@pytest.mark.anyio
async def test_rag_stream_disconnect_marks_stream_terminated_early(monkeypatch):
    budget_ctx = SimpleNamespace(stream_terminated_early=False)

    @asynccontextmanager
    async def fake_reserve_llm_budget(**kwargs):
        if kwargs["route"] == "rag":
            yield budget_ctx
            return
        yield SimpleNamespace(stream_terminated_early=False)

    async def fake_guardrail(**kwargs):
        return allow_result().model_copy(
            update={
                "sanitized_message": "Tell me about rear setbacks",
                "sanitized_history": [],
            }
        )

    async def fake_grader_node(state):
        return state

    async def fake_stream_generation(question, documents, frontend_context):
        yield "Rear setbacks vary. "
        await asyncio.sleep(0.05)
        yield "Check county guidance."

    async def fake_generate_suggested_questions(question: str, answer: str):
        return ["What about side setbacks?"]

    monkeypatch.setattr(rag_router, "get_secret", lambda name: "test-key")
    monkeypatch.setattr(rag_router, "ensure_user_api_key", lambda uid: "fake-user-hash")
    monkeypatch.setattr(rag_router, "reserve_llm_budget", fake_reserve_llm_budget)
    monkeypatch.setattr(rag_router, "evaluate_guardrail_for_turns", fake_guardrail)
    monkeypatch.setattr(rag_router, "rephraser_node", lambda state: state)
    monkeypatch.setattr(
        rag_router,
        "retriever_node",
        lambda state: {**state, "documents": []},
    )
    monkeypatch.setattr(rag_router, "grader_node", fake_grader_node)
    monkeypatch.setattr(rag_router, "evidence_assessor_node", fake_grader_node)
    monkeypatch.setattr(rag_router, "stream_generation", fake_stream_generation)
    monkeypatch.setattr(
        rag_router,
        "generate_suggested_questions",
        fake_generate_suggested_questions,
    )

    response = await rag_router.chat_stream(
        RagChatRequest(message="Tell me about rear setbacks"),
        current_user=TEST_USER,
    )

    sent_messages = []
    receive_calls = 0

    async def receive():
        nonlocal receive_calls
        receive_calls += 1
        if receive_calls == 1:
            return {"type": "http.request", "body": b"", "more_body": False}
        return {"type": "http.disconnect"}

    async def send(message):
        sent_messages.append(message)

    await response(
        {"type": "http", "method": "POST", "path": "/chat/stream"},
        receive,
        send,
    )

    assert any(message["type"] == "http.response.start" for message in sent_messages)
    assert budget_ctx.stream_terminated_early is True


@pytest.mark.anyio
async def test_orchestrate_stream_raises_429_before_starting_sse(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")

    @asynccontextmanager
    async def fake_reserve_llm_budget(**kwargs):
        raise HTTPException(status_code=429, detail="Cost budget exceeded.")
        yield

    monkeypatch.setattr(
        orchestrator_router,
        "reserve_llm_budget",
        fake_reserve_llm_budget,
    )
    monkeypatch.setattr(
        orchestrator_router,
        "ensure_user_api_key",
        lambda uid: "fake-user-hash",
    )

    with pytest.raises(HTTPException) as exc_info:
        await orchestrator_router.orchestrate_stream(
            OrchestratorRequest(message="Add slope work to my estimate?"),
            current_user=TEST_USER,
        )

    assert exc_info.value.status_code == 429


@pytest.mark.anyio
async def test_orchestrate_stream_response_call_does_not_crash_on_context_cleanup(
    monkeypatch,
):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")

    @asynccontextmanager
    async def fake_reserve_llm_budget(**kwargs):
        yield SimpleNamespace(stream_terminated_early=False)

    async def fake_hydrate_project_node(state):
        return state

    async def fake_generate_welcome_summary_node(state):
        return {**state, "welcome_summary": "Resume summary"}

    async def fake_generate_suggested_questions(question: str, answer: str):
        return ["Setback rules", "Permit timing"]

    monkeypatch.setattr(
        orchestrator_router,
        "reserve_llm_budget",
        fake_reserve_llm_budget,
    )
    monkeypatch.setattr(
        orchestrator_router,
        "ensure_user_api_key",
        lambda uid: "fake-user-hash",
    )
    monkeypatch.setattr(
        orchestrator_router,
        "hydrate_project_node",
        fake_hydrate_project_node,
    )
    monkeypatch.setattr(
        orchestrator_router,
        "generate_welcome_summary_node",
        fake_generate_welcome_summary_node,
    )
    monkeypatch.setattr(
        orchestrator_router,
        "generate_suggested_questions",
        fake_generate_suggested_questions,
    )

    response = await orchestrator_router.orchestrate_stream(
        OrchestratorRequest(message="SYSTEM_RESUME_CHAT"),
        current_user=TEST_USER,
    )

    sent_messages = []
    receive_calls = 0

    async def receive():
        nonlocal receive_calls
        receive_calls += 1
        if receive_calls == 1:
            return {"type": "http.request", "body": b"", "more_body": False}
        return {"type": "http.disconnect"}

    async def send(message):
        sent_messages.append(message)

    await response(
        {"type": "http", "method": "POST", "path": "/agent/orchestrate/stream"},
        receive,
        send,
    )

    body = b"".join(
        message.get("body", b"")
        for message in sent_messages
        if message["type"] == "http.response.body"
    ).decode()
    assert 'data: {"text": "Resume summary"}' in body
    assert (
        'event: suggested_questions\ndata: ["Setback rules", "Permit timing"]' in body
    )
    assert any(message["type"] == "http.response.start" for message in sent_messages)


@pytest.mark.anyio
async def test_orchestrate_stream_does_not_schedule_background_consolidation(
    monkeypatch,
):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    reserve_routes: list[str] = []

    @asynccontextmanager
    async def fake_reserve_llm_budget(**kwargs):
        reserve_routes.append(kwargs["route"])
        yield SimpleNamespace(stream_terminated_early=False)

    async def fake_hydrate_project_node(state):
        return state

    async def fake_orchestrate_node(state):
        return {**state, "route": "ROUTE_RAG"}

    async def fake_grader_node(state):
        return state

    async def fake_stream_generation(question, documents, frontend_context):
        yield "No report mutation on chat resume."

    async def fake_generate_suggested_questions(question: str, answer: str):
        return ["Next step?"]

    monkeypatch.setattr(
        orchestrator_router,
        "reserve_llm_budget",
        fake_reserve_llm_budget,
    )
    monkeypatch.setattr(
        orchestrator_router,
        "ensure_user_api_key",
        lambda uid: "fake-user-hash",
    )
    monkeypatch.setattr(
        orchestrator_router,
        "ensure_project_access",
        lambda project_id, current_user_id: None,
    )
    monkeypatch.setattr(
        orchestrator_router,
        "hydrate_project_node",
        fake_hydrate_project_node,
    )
    monkeypatch.setattr(
        orchestrator_router,
        "orchestrate_node",
        fake_orchestrate_node,
    )
    monkeypatch.setattr(orchestrator_router, "rephraser_node", lambda state: state)
    monkeypatch.setattr(
        orchestrator_router,
        "retriever_node",
        lambda state: {**state, "documents": []},
    )
    monkeypatch.setattr(orchestrator_router, "grader_node", fake_grader_node)
    monkeypatch.setattr(
        orchestrator_router,
        "evidence_assessor_node",
        fake_grader_node,
    )
    monkeypatch.setattr(
        orchestrator_router,
        "stream_generation",
        fake_stream_generation,
    )
    monkeypatch.setattr(
        orchestrator_router,
        "generate_suggested_questions",
        fake_generate_suggested_questions,
    )
    response = await orchestrator_router.orchestrate_stream(
        OrchestratorRequest(message="Update my ADU plan", project_id="project-123"),
        current_user=TEST_USER,
    )

    chunks: list[str] = []
    async for chunk in response.body_iterator:
        chunks.append(chunk if isinstance(chunk, str) else chunk.decode())

    body = "".join(chunks)
    assert "event: done" in body
    assert reserve_routes == ["guardrail", "orchestrator", "rag"]


@pytest.mark.anyio
async def test_orchestrate_stream_emits_done_on_midstream_failure(monkeypatch):
    """A mid-stream failure must terminate the SSE stream cleanly (done +
    failure message), not tear down the connection silently."""
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")

    budget_ctx = SimpleNamespace(stream_terminated_early=False)

    @asynccontextmanager
    async def fake_reserve_llm_budget(**kwargs):
        yield budget_ctx

    async def fake_hydrate_project_node(state):
        return state

    async def fake_orchestrate_node(state):
        return {**state, "route": "ROUTE_RAG"}

    async def boom_grader_node(state):
        raise RuntimeError("grader exploded mid-stream")

    async def fake_generate_suggested_questions(question: str, answer: str):
        return []

    monkeypatch.setattr(
        orchestrator_router, "reserve_llm_budget", fake_reserve_llm_budget
    )
    monkeypatch.setattr(
        orchestrator_router, "ensure_user_api_key", lambda uid: "fake-user-hash"
    )
    monkeypatch.setattr(
        orchestrator_router,
        "ensure_project_access",
        lambda project_id, current_user_id: None,
    )
    monkeypatch.setattr(
        orchestrator_router, "hydrate_project_node", fake_hydrate_project_node
    )
    monkeypatch.setattr(orchestrator_router, "orchestrate_node", fake_orchestrate_node)
    monkeypatch.setattr(orchestrator_router, "rephraser_node", lambda state: state)
    monkeypatch.setattr(
        orchestrator_router,
        "retriever_node",
        lambda state: {**state, "documents": []},
    )
    monkeypatch.setattr(orchestrator_router, "grader_node", boom_grader_node)
    monkeypatch.setattr(
        orchestrator_router,
        "generate_suggested_questions",
        fake_generate_suggested_questions,
    )

    response = await orchestrator_router.orchestrate_stream(
        OrchestratorRequest(message="Update my ADU plan", project_id="project-123"),
        current_user=TEST_USER,
    )

    chunks: list[str] = []
    async for chunk in response.body_iterator:
        chunks.append(chunk if isinstance(chunk, str) else chunk.decode())

    body = "".join(chunks)
    # The connection must close cleanly with a terminal event, and because no
    # answer text was streamed before the failure, a fallback message too.
    assert "event: done" in body
    assert GENERIC_ERROR_MESSAGE in body
    # The failed turn is excluded from the cost estimator (issue 5).
    assert budget_ctx.stream_terminated_early is True


@pytest.mark.anyio
async def test_consolidator_analysis_records_usage(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")

    class FakeLLM:
        def __init__(self, **kwargs):
            self.model = kwargs.get("model")

        async def ainvoke(self, messages):
            return SimpleNamespace(
                content='{"should_update": false, "affected_sections": [], "reasoning": "No change"}',
                usage_metadata={
                    "input_tokens": 11,
                    "output_tokens": 7,
                    "total_tokens": 18,
                    "input_token_details": {"cache_read": 0},
                },
                response_metadata={"model_name": "deepseek-v4-flash"},
            )

    monkeypatch.setattr(
        orchestrator_consolidator,
        "build_chat_llm",
        lambda **kwargs: FakeLLM(**kwargs),
    )

    with usage_accumulator_scope(LLMUsageAccumulator()) as accumulator:
        result = await orchestrator_consolidator.analyse_exchange(
            {"executive_summary": "Existing report"},
            {"key_questions": ["Budget?"]},
            "Any update?",
            "No new project facts yet.",
        )

    summary = accumulator.snapshot()
    assert result["should_update"] is False
    assert summary.total_tokens == 18
    assert summary.cost_micros > 0
    assert summary.breakdowns[0].route == "consolidator"
    assert summary.breakdowns[0].source == "orchestrator.consolidator.analyse_exchange"


@pytest.mark.anyio
async def test_consolidator_delta_records_usage(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")

    class FakeLLM:
        def __init__(self, **kwargs):
            self.model = kwargs.get("model")

        async def ainvoke(self, messages):
            return SimpleNamespace(
                content='{"visible": {"executive_summary": "Updated summary"}}',
                usage_metadata={
                    "input_tokens": 9,
                    "output_tokens": 5,
                    "total_tokens": 14,
                    "input_token_details": {"cache_read": 0},
                },
                response_metadata={"model_name": "deepseek-v4-flash"},
            )

    monkeypatch.setattr(
        orchestrator_consolidator,
        "build_chat_llm",
        lambda **kwargs: FakeLLM(**kwargs),
    )

    with usage_accumulator_scope(LLMUsageAccumulator()) as accumulator:
        delta = await orchestrator_consolidator.generate_delta(
            {"executive_summary": "Current summary"},
            {},
            ["executive_summary"],
            "Please update the summary.",
            "Here is the latest summary.",
        )

    summary = accumulator.snapshot()
    assert delta == {"visible": {"executive_summary": "Updated summary"}}
    assert summary.total_tokens == 14
    assert summary.cost_micros > 0
    assert summary.breakdowns[0].route == "consolidator"
    assert summary.breakdowns[0].source == "orchestrator.consolidator.generate_delta"


@pytest.mark.anyio
async def test_calculator_requires_auth():
    with pytest.raises(HTTPException) as exc_info:
        financial_router.calculator_endpoint(
            CalculatorRequest(county="Orange County", adu_sqft=600),
            current_user=None,
        )

    assert exc_info.value.status_code == 401


@pytest.mark.anyio
async def test_calculator_allows_authenticated_request_without_project(monkeypatch):
    def fake_calculate_finance_snapshot(**kwargs):
        finance_state = FinanceStateSnapshot(
            county="Orange County",
            adu_sqft=600,
            base_estimate_value=1000,
            base_estimate_range=EstimateRange(low=900, high=1100),
        )
        presentation = financial_reporting.build_finance_presentation(finance_state)
        return finance_state, presentation

    monkeypatch.setattr(
        financial_router,
        "calculate_finance_snapshot",
        fake_calculate_finance_snapshot,
    )

    response = financial_router.calculator_endpoint(
        CalculatorRequest(county="Orange County", adu_sqft=600),
        current_user=TEST_USER,
    )

    assert response.report_synced is False


@pytest.mark.anyio
async def test_calculator_ignores_project_scope_and_persist_flag(monkeypatch):
    captured_kwargs: dict | None = None

    def fake_calculate_finance_snapshot(**kwargs):
        nonlocal captured_kwargs
        captured_kwargs = kwargs
        finance_state = FinanceStateSnapshot(
            county="Orange County",
            adu_sqft=600,
            base_estimate_value=1000,
            base_estimate_range=EstimateRange(low=900, high=1100),
        )
        presentation = financial_reporting.build_finance_presentation(finance_state)
        return finance_state, presentation

    monkeypatch.setattr(
        financial_router,
        "calculate_finance_snapshot",
        fake_calculate_finance_snapshot,
    )

    response = financial_router.calculator_endpoint(
        CalculatorRequest(
            project_id="project-123",
            persist_finance_state=True,
        ),
        current_user=SimpleNamespace(id="user-999"),
    )

    assert captured_kwargs is not None
    assert "current_user_id" not in captured_kwargs
    assert "persist_finance_state" not in captured_kwargs
    assert "project_id" not in captured_kwargs
    assert response.report_synced is False


def test_update_project_accepts_finance_state(monkeypatch):
    captured_body: ProjectUpdate | None = None

    def fake_update_project(db, project_id, body, *, user_id=None):
        nonlocal captured_body
        captured_body = body
        return SimpleNamespace(id=project_id, finance_state=body.finance_state)

    monkeypatch.setattr(ReportRepository, "update_project", fake_update_project)
    monkeypatch.setattr(
        ReportRepository,
        "get_report_by_project",
        lambda db, project_id, user_id=None: None,
    )
    monkeypatch.setattr(reports_router, "_project_out", lambda project: project)

    result = reports_router.update_project(
        "project-123",
        ProjectUpdate(finance_state={"county": "Orange County"}),
        current_user=TEST_USER,
        db=object(),
    )

    assert captured_body is not None
    assert captured_body.finance_state == {"county": "Orange County"}
    assert result.finance_state == {"county": "Orange County"}


def test_update_project_accepts_map_snapshot(monkeypatch):
    captured_body: ProjectUpdate | None = None
    expected_snapshot = {"version": 1, "selectedLocation": {"lat": 33.6, "lng": -117.8}}

    def fake_update_project(db, project_id, body, *, user_id=None):
        nonlocal captured_body
        captured_body = body
        return SimpleNamespace(id=project_id, map_snapshot=body.map_snapshot)

    monkeypatch.setattr(ReportRepository, "update_project", fake_update_project)
    monkeypatch.setattr(
        ReportRepository,
        "get_report_by_project",
        lambda db, project_id, user_id=None: None,
    )
    monkeypatch.setattr(reports_router, "_project_out", lambda project: project)

    result = reports_router.update_project(
        "project-123",
        ProjectUpdate(map_snapshot=expected_snapshot),
        current_user=TEST_USER,
        db=object(),
    )

    assert captured_body is not None
    assert captured_body.map_snapshot == expected_snapshot
    assert result.map_snapshot == expected_snapshot


def test_create_project_accepts_finance_state(monkeypatch):
    captured_body: ProjectCreate | None = None

    def fake_create_project(db, body, *, user_id=None):
        nonlocal captured_body
        captured_body = body
        return SimpleNamespace(
            id="project-123",
            user_id=user_id,
            finance_state=body.finance_state,
        )

    monkeypatch.setattr(ReportRepository, "create_project", fake_create_project)
    monkeypatch.setattr(reports_router, "_project_out", lambda project: project)

    result = reports_router.create_project(
        ProjectCreate(
            address="123 Oak St",
            finance_state={"county": "Orange County"},
        ),
        current_user=TEST_USER,
        db=object(),
    )

    assert captured_body is not None
    assert captured_body.finance_state == {"county": "Orange County"}
    assert result.finance_state == {"county": "Orange County"}


def test_create_project_accepts_map_snapshot(monkeypatch):
    captured_body: ProjectCreate | None = None
    expected_snapshot = {"version": 1, "selectedLocation": {"lat": 33.6, "lng": -117.8}}

    def fake_create_project(db, body, *, user_id=None):
        nonlocal captured_body
        captured_body = body
        return SimpleNamespace(
            id="project-123",
            user_id=user_id,
            map_snapshot=body.map_snapshot,
        )

    monkeypatch.setattr(ReportRepository, "create_project", fake_create_project)
    monkeypatch.setattr(reports_router, "_project_out", lambda project: project)

    result = reports_router.create_project(
        ProjectCreate(
            address="123 Oak St",
            map_snapshot=expected_snapshot,
        ),
        current_user=TEST_USER,
        db=object(),
    )

    assert captured_body is not None
    assert captured_body.map_snapshot == expected_snapshot
    assert result.map_snapshot == expected_snapshot


def test_update_project_does_not_sync_existing_report(monkeypatch):
    saved_finance_state = {
        "county": "Contra Costa County",
        "adu_sqft": 600,
        "base_estimate_value": 217900.0,
        "base_estimate_range": {"low": 174320.0, "high": 261480.0},
    }

    monkeypatch.setattr(
        ReportRepository,
        "update_project",
        lambda db, project_id, body, *, user_id=None: SimpleNamespace(
            id=project_id,
            finance_state=saved_finance_state,
        ),
    )
    monkeypatch.setattr(
        ReportRepository,
        "get_report_by_project",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError("Project saves must not read reports")
        ),
    )
    monkeypatch.setattr(reports_router, "_project_out", lambda project: project)

    reports_router.update_project(
        "project-123",
        ProjectUpdate(finance_state=saved_finance_state),
        current_user=TEST_USER,
        db=object(),
    )

    assert saved_finance_state["adu_sqft"] == 600


def test_update_project_sections_do_not_read_or_update_report(monkeypatch):
    saved_project = SimpleNamespace(
        id="project-123",
        address="123 Oak St",
        county="Orange County",
        property_area_sqft=7200,
        buildable_area_sqft=1800,
        setback_ft=4,
        max_adu_sqft=1200,
        adu_sqft=750,
        adu_type="attached",
        adu_shape="rectangle",
        primary_use="rental",
        blocker_types=["utility coordination"],
        fire_hazard_severity="Moderate",
        fire_hazard_zone_type="LRA",
        current_yard_zone="Rear yard",
        adu_clearances=[],
        finance_state=None,
        report_preload=None,
    )
    monkeypatch.setattr(
        ReportRepository,
        "update_project",
        lambda db, project_id, body, *, user_id=None: saved_project,
    )
    monkeypatch.setattr(
        ReportRepository,
        "get_report_by_project",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError("Project saves must not read reports")
        ),
    )
    monkeypatch.setattr(reports_router, "_project_out", lambda project: project)

    reports_router.update_project(
        "project-123",
        ProjectUpdate(
            adu_sqft=750,
            adu_type="attached",
            map_snapshot={"version": 2, "adu": {"size": 750, "type": "attached"}},
        ),
        current_user=TEST_USER,
        db=object(),
    )

    assert saved_project.adu_sqft == 750


def test_update_project_skips_report_sync_without_existing_report(monkeypatch):
    monkeypatch.setattr(
        ReportRepository,
        "update_project",
        lambda db, project_id, body, *, user_id=None: SimpleNamespace(
            id=project_id,
            finance_state=body.finance_state,
        ),
    )
    monkeypatch.setattr(
        ReportRepository,
        "get_report_by_project",
        lambda db, project_id, user_id=None: None,
    )
    monkeypatch.setattr(
        ReportRepository,
        "delta_update",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError("delta_update should not run without an existing report")
        ),
    )
    monkeypatch.setattr(reports_router, "_project_out", lambda project: project)

    result = reports_router.update_project(
        "project-123",
        ProjectUpdate(finance_state={"county": "Orange County"}),
        current_user=TEST_USER,
        db=object(),
    )

    assert result.finance_state == {"county": "Orange County"}


def test_update_project_does_not_accept_report_preload(monkeypatch):
    monkeypatch.setattr(
        ReportRepository,
        "update_project",
        lambda db, project_id, body, *, user_id=None: SimpleNamespace(
            id=project_id,
            finance_state={"county": "Orange County"},
        ),
    )
    monkeypatch.setattr(
        ReportRepository,
        "get_report_by_project",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError("Project saves must not read reports")
        ),
    )
    monkeypatch.setattr(reports_router, "_project_out", lambda project: project)

    result = reports_router.update_project(
        "project-123",
        ProjectUpdate(map_snapshot={"version": 2}),
        current_user=TEST_USER,
        db=object(),
    )

    assert result.finance_state == {"county": "Orange County"}


def test_persist_project_finance_state_scopes_writes_to_current_user(monkeypatch):
    captured_calls: list[tuple[str, str | None]] = []
    finance_state = FinanceStateSnapshot(
        county="Orange County",
        adu_sqft=600,
        base_estimate_value=1000,
        base_estimate_range=EstimateRange(low=900, high=1100),
    )

    def fake_update_project_finance_state(db, project_id, state, *, user_id=None):
        captured_calls.append(("project", user_id))
        return SimpleNamespace(id=project_id)

    monkeypatch.setattr(db_core, "SessionLocal", lambda: FakeSession())
    monkeypatch.setattr(
        ReportRepository,
        "update_project_finance_state",
        fake_update_project_finance_state,
    )

    persisted = financial_reporting.persist_project_finance_state(
        "project-123",
        finance_state,
        current_user_id="user-123",
    )

    assert persisted is True
    assert captured_calls == [("project", "user-123")]


def test_orchestrator_persist_finance_state_scopes_writes_to_current_user(monkeypatch):
    captured_calls: list[tuple[str, dict, str | None]] = []
    finance_state = {"county": "Orange County", "adu_sqft": 600}

    def fake_update_project_finance_state(db, project_id, state, *, user_id=None):
        captured_calls.append((project_id, state, user_id))
        return SimpleNamespace(id=project_id)

    monkeypatch.setattr(orchestrator_router, "SessionLocal", lambda: FakeSession())
    monkeypatch.setattr(
        ReportRepository,
        "update_project_finance_state",
        fake_update_project_finance_state,
    )

    orchestrator_router.persist_finance_state_if_present(
        "project-123",
        current_user_id="user-123",
        finance_state=finance_state,
    )

    assert captured_calls == [("project-123", finance_state, "user-123")]


@pytest.mark.anyio
async def test_hydrate_project_node_scopes_project_without_reading_report(
    monkeypatch,
):
    captured_calls: list[tuple[str, str | None]] = []
    project = SimpleNamespace(
        id="project-123",
        finance_state={"county": "Orange County"},
        address=None,
        county=None,
        property_area_sqft=None,
        buildable_area_sqft=None,
        setback_ft=None,
        max_adu_sqft=None,
        adu_sqft=None,
        adu_type=None,
        primary_use=None,
        fire_hazard_severity=None,
        fire_hazard_zone_type=None,
        current_yard_zone=None,
        adu_clearances=[],
        blocker_types=[],
    )

    def fake_get_project(db, project_id, user_id=None):
        captured_calls.append(("project", user_id))
        return project

    monkeypatch.setattr(db_core, "SessionLocal", lambda: FakeSession())
    monkeypatch.setattr(ReportRepository, "get_project", fake_get_project)
    monkeypatch.setattr(
        ReportRepository,
        "get_report_by_project",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError("Chat hydration must not read reports")
        ),
    )

    state = {
        "request": OrchestratorRequest(
            message="Load my project.",
            project_id="project-123",
        ),
        "route": "",
        "response": None,
        "answer_safe_context": "",
        "internal_context": "",
        "current_user_id": "user-123",
        "finance_state": None,
        "finance_report_synced": False,
        "is_new_session": False,
        "welcome_summary": None,
    }

    await orchestrator_graph.hydrate_project_node(state)

    assert captured_calls == [("project", "user-123")]
