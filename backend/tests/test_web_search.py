from __future__ import annotations

import pytest
from langchain_core.documents import Document

from RAG_pipeline.graph.nodes import web_search as web_search_module
from RAG_pipeline.graph.nodes.web_search import web_search_node
from RAG_pipeline.schemas import WebSourceAssessment, WebSourceDecision


def _state():
    return {
        "question": "setback rules",
        "documents": [Document(page_content="handbook evidence")],
        "web_search_query": "Irvine California ADU local setback rules",
    }


@pytest.mark.anyio
async def test_web_search_accepts_trusted_sources_and_rejects_blog(
    monkeypatch,
):
    monkeypatch.setenv("SERPER_API_KEY", "test-key")

    async def fake_fetch_serper_results(*, api_key, queries, num_results):
        assert api_key == "test-key"
        assert queries == [
            "Irvine California ADU local setback rules",
            (
                "Irvine California ADU local setback rules planning building "
                "department official requirements"
            ),
        ]
        assert num_results == 5
        return [
            {
                "results": [
                    {
                        "title": "Irvine ADU Standards",
                        "url": "https://cityofirvine.org/adu",
                        "content": "Irvine publishes local ADU standards.",
                    },
                    {
                        "title": "California ADU Analysis",
                        "url": "https://planningfirm.com/irvine-adu",
                        "content": "A planning firm explains Irvine requirements.",
                    },
                    {
                        "title": "My ADU Thoughts",
                        "url": "https://randomblog.example/adu",
                        "content": "An anonymous post discusses setbacks.",
                    },
                ]
            },
            {
                "results": [
                    {
                        "title": "Duplicate Irvine ADU Standards",
                        "url": "https://cityofirvine.org/adu",
                        "content": "Duplicate result from the second query.",
                    },
                    {
                        "title": "Orange County Planning",
                        "url": "https://ocpublicworks.com/adu",
                        "content": "Orange County publishes planning guidance.",
                    },
                ]
            },
        ]

    class FakeLlm:
        async def ainvoke(self, prompt):
            assert "randomblog.example" in prompt
            assert "ocpublicworks.com" in prompt
            return {
                "parsed": WebSourceAssessment(
                    accepted_sources=[
                        WebSourceDecision(source_number=1, authority="official"),
                        WebSourceDecision(source_number=2, authority="professional"),
                        WebSourceDecision(source_number=4, authority="official"),
                    ]
                ),
                "raw": None,
            }

    monkeypatch.setattr(
        web_search_module, "fetch_serper_results", fake_fetch_serper_results
    )
    monkeypatch.setattr(
        web_search_module, "get_openrouter_key", lambda: "openrouter-key"
    )
    monkeypatch.setattr(web_search_module, "build_chat_llm", lambda **kwargs: FakeLlm())

    result = await web_search_node(_state())

    assert result["web_search_status"] == "succeeded"
    assert [doc.page_content for doc in result["documents"][1:]] == [
        "Irvine publishes local ADU standards.",
        "Orange County publishes planning guidance.",
        "A planning firm explains Irvine requirements.",
    ]
    assert result["documents"][1].metadata["authority"] == "official"


@pytest.mark.anyio
async def test_source_assessment_failure_keeps_only_dot_gov(monkeypatch):
    monkeypatch.setenv("SERPER_API_KEY", "test-key")

    async def fake_fetch_serper_results(**kwargs):
        return [
            {
                "results": [
                    {
                        "title": "HCD",
                        "url": "https://hcd.ca.gov/policy/adu",
                        "content": "Official California ADU guidance.",
                    },
                    {
                        "title": "Local consultant",
                        "url": "https://consultant.example/adu",
                        "content": "Consultant guidance.",
                    },
                ]
            }
        ]

    class FailingLlm:
        async def ainvoke(self, prompt):
            raise RuntimeError("model unavailable")

    monkeypatch.setattr(
        web_search_module, "fetch_serper_results", fake_fetch_serper_results
    )
    monkeypatch.setattr(
        web_search_module, "get_openrouter_key", lambda: "openrouter-key"
    )
    monkeypatch.setattr(
        web_search_module, "build_chat_llm", lambda **kwargs: FailingLlm()
    )

    result = await web_search_node(_state())

    assert result["web_search_status"] == "succeeded"
    assert [doc.metadata["url"] for doc in result["documents"][1:]] == [
        "https://hcd.ca.gov/policy/adu"
    ]
    assert result["documents"][1].metadata["authority"] == "official"


@pytest.mark.anyio
async def test_web_search_reports_no_trusted_results(monkeypatch):
    monkeypatch.setenv("SERPER_API_KEY", "test-key")

    async def fake_fetch_serper_results(**kwargs):
        return [{"results": []}]

    monkeypatch.setattr(
        web_search_module, "fetch_serper_results", fake_fetch_serper_results
    )
    monkeypatch.setattr(
        web_search_module, "get_openrouter_key", lambda: "openrouter-key"
    )
    monkeypatch.setattr(
        web_search_module,
        "build_chat_llm",
        lambda **kwargs: pytest.fail("No candidates should skip trust assessment"),
    )

    result = await web_search_node(_state())

    assert result["web_search_status"] == "no_trusted_results"
    assert result["documents"] == [Document(page_content="handbook evidence")]


@pytest.mark.anyio
async def test_web_search_reports_unavailable_when_serper_key_missing(monkeypatch):
    monkeypatch.delenv("SERPER_API_KEY", raising=False)

    result = await web_search_node(_state())

    assert result["web_search_status"] == "unavailable"
    assert result["documents"] == [Document(page_content="handbook evidence")]


@pytest.mark.anyio
async def test_web_search_reports_failure(monkeypatch):
    monkeypatch.setenv("SERPER_API_KEY", "test-key")

    async def failing_fetch(**kwargs):
        raise RuntimeError("Serper unavailable")

    monkeypatch.setattr(web_search_module, "fetch_serper_results", failing_fetch)

    result = await web_search_node(_state())

    assert result["web_search_status"] == "failed"


@pytest.mark.anyio
async def test_web_search_charges_serper_only_for_successful_queries(monkeypatch):
    from api.rate_limiting.llm_usage import usage_accumulator_scope

    monkeypatch.setenv("SERPER_API_KEY", "test-key")

    async def fake_fetch_serper_results(*, api_key, queries, num_results):
        # _state() issues two queries, but fetch_serper_results drops the one
        # that failed and returns only the single successful response.
        return [{"results": []}]

    monkeypatch.setattr(
        web_search_module, "fetch_serper_results", fake_fetch_serper_results
    )

    with usage_accumulator_scope() as accumulator:
        await web_search_node(_state())
        snapshot = accumulator.snapshot()

    serper = [b for b in snapshot.breakdowns if b.provider == "serper"]
    assert len(serper) == 1
    # Only one query was billed by Serper, so only one is charged.
    assert serper[0].cost_micros == 1_000
    assert serper[0].route == "rag"
    assert serper[0].source == "rag.web_search"


@pytest.mark.anyio
async def test_web_search_does_not_charge_serper_when_key_missing(monkeypatch):
    from api.rate_limiting.llm_usage import usage_accumulator_scope

    monkeypatch.delenv("SERPER_API_KEY", raising=False)

    with usage_accumulator_scope() as accumulator:
        await web_search_node(_state())
        snapshot = accumulator.snapshot()

    assert snapshot.breakdowns == []
