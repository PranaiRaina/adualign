"""Concurrency in the streaming chat endpoint: route || rephrase, and the
speculative web search that overlaps retrieval/grading/evidence assessment."""

from __future__ import annotations

import asyncio
import time
from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest
from langchain_core.documents import Document

import orchestrator.router as orchestrator_router
from api.database.models import User
from orchestrator.schemas import OrchestratorRequest
from RAG_pipeline.graph.nodes.evidence import build_web_search_query

TEST_USER = User(id="stream-concurrency-user", email="s@example.com", name="S")
DELAY_S = 0.2
HANDBOOK_DOC = Document(page_content="handbook", metadata={"source": "ADU Handbook"})
WEB_DOC = Document(page_content="web", metadata={"source": "city.gov"})


def _install_fakes(
    monkeypatch, *, needs_web: bool, local_intent: bool = True, web_delay_s=DELAY_S
):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    calls = {"web_started": 0, "web_finished": 0, "generated_docs": None}

    @asynccontextmanager
    async def fake_reserve_llm_budget(**kwargs):
        yield SimpleNamespace(stream_terminated_early=False)

    async def passthrough(state):
        return state

    async def fake_orchestrate_node(state):
        await asyncio.sleep(DELAY_S)
        return {**state, "route": "ROUTE_RAG"}

    def fake_rephraser_node(state):
        time.sleep(DELAY_S)
        return {**state, "assess_local_evidence": local_intent}

    async def fake_evidence_assessor_node(state):
        await asyncio.sleep(DELAY_S)
        state["run_web_search"] = needs_web
        state["web_search_query"] = build_web_search_query(state) if needs_web else ""
        state["web_search_status"] = "pending" if needs_web else "not_requested"
        return state

    async def fake_web_search_node(state):
        calls["web_started"] += 1
        await asyncio.sleep(web_delay_s)
        calls["web_finished"] += 1
        state["documents"] = state.get("documents", []) + [WEB_DOC]
        state["web_search_status"] = "succeeded"
        return state

    async def fake_stream_generation(question, documents, frontend_context):
        calls["generated_docs"] = list(documents)
        yield "answer"

    async def fake_generate_suggested_questions(question, answer):
        return []

    for name, value in {
        "reserve_llm_budget": fake_reserve_llm_budget,
        "ensure_user_api_key": lambda uid: "hash",
        "ensure_project_access": lambda project_id, current_user_id: None,
        "guardrail_node": passthrough,
        "hydrate_project_node": passthrough,
        "orchestrate_node": fake_orchestrate_node,
        "rephraser_node": fake_rephraser_node,
        "retriever_node": lambda state: {**state, "documents": [HANDBOOK_DOC]},
        "grader_node": passthrough,
        "evidence_assessor_node": fake_evidence_assessor_node,
        "web_search_node": fake_web_search_node,
        "stream_generation": fake_stream_generation,
        "generate_suggested_questions": fake_generate_suggested_questions,
    }.items():
        monkeypatch.setattr(orchestrator_router, name, value)
    return calls


async def _run_stream() -> tuple[float, float]:
    start = time.perf_counter()
    response = await orchestrator_router.orchestrate_stream(
        OrchestratorRequest(message="Can I rent my ADU short-term in Irvine?"),
        current_user=TEST_USER,
    )
    ttfb = time.perf_counter() - start
    async for _chunk in response.body_iterator:
        pass
    return ttfb, time.perf_counter() - start


@pytest.mark.anyio
async def test_route_and_rephrase_run_concurrently(monkeypatch):
    _install_fakes(monkeypatch, needs_web=False, local_intent=False)

    _ttfb, total = await _run_stream()

    # Sequential: 0.2 route + 0.2 rephrase + 0.2 evidence >= 0.6s.
    assert total < 0.5


@pytest.mark.anyio
async def test_speculative_web_search_overlaps_and_is_used(monkeypatch):
    calls = _install_fakes(monkeypatch, needs_web=True)

    ttfb, total = await _run_stream()

    assert calls["web_started"] == 1
    assert calls["generated_docs"] == [HANDBOOK_DOC, WEB_DOC]
    # Web search (0.2s) is hidden behind evidence assessment (0.2s).
    assert total - ttfb < 0.35


@pytest.mark.anyio
async def test_speculative_web_search_cancelled_when_not_needed(monkeypatch):
    # Web search outlasts the evidence check, so it is still in flight.
    calls = _install_fakes(monkeypatch, needs_web=False, web_delay_s=DELAY_S * 3)

    await _run_stream()
    await asyncio.sleep(DELAY_S * 4)

    assert calls["web_started"] == 1
    assert calls["web_finished"] == 0
    assert calls["generated_docs"] == [HANDBOOK_DOC]


@pytest.mark.anyio
async def test_no_speculation_without_local_intent(monkeypatch):
    calls = _install_fakes(monkeypatch, needs_web=False, local_intent=False)

    await _run_stream()

    assert calls["web_started"] == 0


@pytest.mark.anyio
async def test_routing_failure_waits_for_rephraser_inside_reservation(monkeypatch):
    _install_fakes(monkeypatch, needs_web=False)
    events: list[str] = []

    @asynccontextmanager
    async def recording_reserve_llm_budget(**kwargs):
        try:
            yield SimpleNamespace(stream_terminated_early=False)
        finally:
            if kwargs["route"] == "orchestrator":
                events.append("release")

    async def failing_orchestrate_node(state):
        raise RuntimeError("router LLM unavailable")

    def slow_rephraser_node(state):
        time.sleep(DELAY_S)
        events.append("rephraser_done")
        return state

    monkeypatch.setattr(
        orchestrator_router, "reserve_llm_budget", recording_reserve_llm_budget
    )
    monkeypatch.setattr(
        orchestrator_router, "orchestrate_node", failing_orchestrate_node
    )
    monkeypatch.setattr(orchestrator_router, "rephraser_node", slow_rephraser_node)

    with pytest.raises(RuntimeError, match="router LLM unavailable"):
        await _run_stream()

    # The rephraser's LLM usage must land before its reservation is released.
    assert events == ["rephraser_done", "release"]
