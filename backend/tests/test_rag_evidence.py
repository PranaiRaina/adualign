from __future__ import annotations

import pytest
from langchain_core.documents import Document

from RAG_pipeline.graph.nodes import evidence as evidence_module
from RAG_pipeline.graph.nodes.evidence import (
    build_web_search_query,
    evidence_assessor_node,
)
from RAG_pipeline.graph.nodes.workflow import build_graph
from RAG_pipeline.schemas import EvidenceDecision


def _state(*, question: str, documents: list[Document], **context):
    return {
        "question": question,
        "original_question": question,
        "documents": documents,
        "run_web_search": False,
        "generation": "",
        "frontend_context": context,
    }


def test_build_web_search_query_uses_project_location():
    state = _state(
        question="What permits do I need?",
        documents=[],
        address="123 Main St, Irvine, CA",
        county="Orange County",
    )

    assert build_web_search_query(state) == (
        "123 Main St, Irvine, CA, Orange County California ADU local regulations "
        "What permits do I need?"
    )


def test_workflow_assesses_evidence_after_grading():
    graph = build_graph().get_graph()
    edges = {(edge.source, edge.target) for edge in graph.edges}

    assert ("grader", "evidence") in edges
    assert ("evidence", "web_search") in edges
    assert ("evidence", "generator") in edges
    assert ("grader", "web_search") not in edges


@pytest.mark.anyio
async def test_no_handbook_evidence_requests_web_without_llm(monkeypatch):
    monkeypatch.setattr(
        evidence_module,
        "build_chat_llm",
        lambda **kwargs: pytest.fail("LLM should not be called"),
    )
    state = _state(question="What are Irvine's ADU rules?", documents=[])

    result = await evidence_assessor_node(state)

    assert result["evidence_strategy"] == "handbook_plus_web"
    assert result["run_web_search"] is True
    assert result["web_search_status"] == "pending"


@pytest.mark.anyio
async def test_vague_local_handbook_evidence_requests_web(monkeypatch):
    decision = EvidenceDecision(
        strategy="handbook_plus_web",
        handbook_answerability="partial",
        reason="The excerpt defers to local zoning rules.",
    )

    class FakeLlm:
        async def ainvoke(self, prompt):
            assert "consult local zoning rules" in prompt
            assert "Orange County" in prompt
            return {"parsed": decision, "raw": None}

    monkeypatch.setattr(evidence_module, "get_openrouter_key", lambda: "test-key")
    monkeypatch.setattr(evidence_module, "build_chat_llm", lambda **kwargs: FakeLlm())
    state = _state(
        question="What local setback applies to my property?",
        documents=[
            Document(page_content="Applicants should consult local zoning rules.")
        ],
        county="Orange County",
    )

    result = await evidence_assessor_node(state)

    assert result["evidence_strategy"] == "handbook_plus_web"
    assert result["run_web_search"] is True


@pytest.mark.anyio
async def test_direct_statewide_handbook_answer_skips_web(monkeypatch):
    decision = EvidenceDecision(
        strategy="handbook_only",
        handbook_answerability="sufficient",
        reason="The handbook directly answers the statewide question.",
    )

    class FakeLlm:
        async def ainvoke(self, prompt):
            return {"parsed": decision, "raw": None}

    monkeypatch.setattr(evidence_module, "get_openrouter_key", lambda: "test-key")
    monkeypatch.setattr(evidence_module, "build_chat_llm", lambda **kwargs: FakeLlm())
    state = _state(
        question="What is California's minimum rear setback?",
        documents=[Document(page_content="The minimum rear setback is four feet.")],
        address="123 Main St, Irvine, CA",
    )

    result = await evidence_assessor_node(state)

    assert result["evidence_strategy"] == "handbook_only"
    assert result["run_web_search"] is False
    assert result["web_search_status"] == "not_requested"
    assert result["web_search_query"] == ""


@pytest.mark.anyio
async def test_statewide_gate_skips_adequacy_llm(monkeypatch):
    monkeypatch.setattr(evidence_module, "get_openrouter_key", lambda: "test-key")
    monkeypatch.setattr(
        evidence_module,
        "build_chat_llm",
        lambda **kwargs: pytest.fail("Adequacy LLM should be skipped"),
    )
    state = _state(
        question="What is California's statewide ADU size limit?",
        documents=[Document(page_content="The statewide size limit is described.")],
        county="Orange County",
    )
    state["assess_local_evidence"] = False

    result = await evidence_assessor_node(state)

    assert result["run_web_search"] is False
    assert result["web_search_status"] == "not_requested"


@pytest.mark.anyio
async def test_assessor_failure_searches_only_for_explicit_local_intent(monkeypatch):
    class FailingLlm:
        async def ainvoke(self, prompt):
            raise RuntimeError("model unavailable")

    monkeypatch.setattr(evidence_module, "get_openrouter_key", lambda: "test-key")
    monkeypatch.setattr(
        evidence_module, "build_chat_llm", lambda **kwargs: FailingLlm()
    )
    document = Document(page_content="Some handbook evidence.")

    local_result = await evidence_assessor_node(
        _state(question="What local rule applies?", documents=[document])
    )
    statewide_result = await evidence_assessor_node(
        _state(question="What does California require?", documents=[document])
    )

    assert local_result["run_web_search"] is True
    assert statewide_result["run_web_search"] is False


@pytest.mark.anyio
async def test_assessor_failure_preserves_rephraser_local_decision(monkeypatch):
    class FailingLlm:
        async def ainvoke(self, prompt):
            raise RuntimeError("model unavailable")

    monkeypatch.setattr(evidence_module, "get_openrouter_key", lambda: "test-key")
    monkeypatch.setattr(
        evidence_module,
        "build_chat_llm",
        lambda **kwargs: FailingLlm(),
    )
    state = _state(
        question="What does Irvine require?",
        documents=[Document(page_content="Consult applicable requirements.")],
    )
    state["assess_local_evidence"] = True

    result = await evidence_assessor_node(state)

    assert result["run_web_search"] is True
    assert result["web_search_status"] == "pending"
