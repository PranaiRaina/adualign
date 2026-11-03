import pytest

from financial_chatbot import graph as finance_graph_module
from financial_chatbot.graph import (
    SourceRelevanceDecision,
    SourceRelevanceVerdict,
    apply_relevance_verdict,
    filter_relevant_sources,
    filter_sources_node,
)


def _source(name: str) -> dict:
    return {
        "source": name,
        "chunk_text": f"evidence for {name}",
        "url": f"https://x/{name}",
    }


def test_apply_relevance_verdict_keeps_relevant_and_drops_irrelevant():
    sources = [_source("a"), _source("b"), _source("c")]
    verdict = SourceRelevanceVerdict(
        decisions=[
            SourceRelevanceDecision(index=1, keep=True),
            SourceRelevanceDecision(index=2, keep=False),
            SourceRelevanceDecision(index=3, keep=True),
        ]
    )

    kept = apply_relevance_verdict(sources, verdict)

    assert [source["source"] for source in kept] == ["a", "c"]


def test_apply_relevance_verdict_defaults_missing_index_to_keep():
    sources = [_source("a"), _source("b"), _source("c")]
    verdict = SourceRelevanceVerdict(
        decisions=[SourceRelevanceDecision(index=2, keep=False)]
    )

    kept = apply_relevance_verdict(sources, verdict)

    assert [source["source"] for source in kept] == ["a", "c"]


def test_apply_relevance_verdict_fails_open_when_verdict_missing():
    sources = [_source("a"), _source("b")]

    assert apply_relevance_verdict(sources, None) == sources


def test_apply_relevance_verdict_fails_open_when_everything_dropped():
    sources = [_source("a"), _source("b")]
    verdict = SourceRelevanceVerdict(
        decisions=[
            SourceRelevanceDecision(index=1, keep=False),
            SourceRelevanceDecision(index=2, keep=False),
        ]
    )

    assert apply_relevance_verdict(sources, verdict) == sources


@pytest.mark.anyio
async def test_filter_relevant_sources_skips_llm_for_single_source(monkeypatch):
    called = False

    async def fake_run(prompt):
        nonlocal called
        called = True
        return None

    monkeypatch.setattr(finance_graph_module, "run_source_relevance_llm", fake_run)

    sources = [_source("a")]
    result = await filter_relevant_sources({"message": "hi", "sources": sources})

    assert result == sources
    assert called is False


@pytest.mark.anyio
async def test_filter_relevant_sources_applies_llm_verdict(monkeypatch):
    seen_prompt = {}

    async def fake_run(prompt):
        seen_prompt["value"] = prompt
        return SourceRelevanceVerdict(
            decisions=[
                SourceRelevanceDecision(index=1, keep=True),
                SourceRelevanceDecision(index=2, keep=False),
            ]
        )

    monkeypatch.setattr(finance_graph_module, "run_source_relevance_llm", fake_run)

    sources = [_source("relevant"), _source("noise")]
    result = await filter_relevant_sources(
        {"message": "ADU permit costs", "sources": sources}
    )

    assert [source["source"] for source in result] == ["relevant"]
    assert "ADU permit costs" in seen_prompt["value"]


@pytest.mark.anyio
async def test_filter_relevant_sources_fails_open_when_llm_raises(monkeypatch):
    async def fake_run(prompt):
        raise RuntimeError("OpenRouter 503 ServiceUnavailable")

    monkeypatch.setattr(finance_graph_module, "run_source_relevance_llm", fake_run)

    sources = [_source("a"), _source("b")]
    result = await filter_relevant_sources({"message": "ADU costs", "sources": sources})

    assert result == sources


@pytest.mark.anyio
async def test_filter_sources_node_replaces_sources_in_state(monkeypatch):
    async def fake_run(prompt):
        return SourceRelevanceVerdict(
            decisions=[
                SourceRelevanceDecision(index=1, keep=False),
                SourceRelevanceDecision(index=2, keep=True),
            ]
        )

    monkeypatch.setattr(finance_graph_module, "run_source_relevance_llm", fake_run)

    state = {
        "message": "ADU financing options",
        "sources": [_source("drop"), _source("keep")],
        "answer": "",
    }

    result = await filter_sources_node(state)

    assert [source["source"] for source in result["sources"]] == ["keep"]
    assert result["answer"] == ""
