import asyncio
from types import SimpleNamespace

import pytest

from api import serper as serper_module

from api.llm import litellm_client
from financial_chatbot import graph as finance_graph_module
from financial_chatbot.graph import research_node, search_web_node, stream_answer_text
from financial_chatbot.schemas import FinancePresentationInput, FinanceStateSnapshot


@pytest.mark.anyio
async def test_search_web_node_runs_serper_queries_in_parallel(monkeypatch):
    monkeypatch.setenv("SERPER_API_KEY", "test-key")
    in_flight = 0
    max_in_flight = 0
    lock = asyncio.Lock()

    async def fake_search_serper_query(
        *, client, api_key: str, query: str, num_results: int
    ):
        nonlocal in_flight, max_in_flight
        assert api_key == "test-key"
        async with lock:
            in_flight += 1
            max_in_flight = max(max_in_flight, in_flight)
        await asyncio.sleep(0.05)
        async with lock:
            in_flight -= 1
        return {
            "results": [
                {
                    "title": f"Source for {query}",
                    "url": f"https://example.com/{query}",
                    "content": f"Evidence for {query}",
                }
            ]
        }

    monkeypatch.setattr(serper_module, "search_serper_query", fake_search_serper_query)

    state = {
        "message": "Compare construction options",
        "history": [],
        "answer_safe_context": None,
        "finance_state": FinanceStateSnapshot(),
        "presentation": FinancePresentationInput(),
        "search_queries": ["steel framing", "prefab ADU", "panelized walls"],
        "sources": [],
        "research_summary": "",
        "answer": "",
        "suggested_questions": [],
    }

    result = await search_web_node(state)

    assert max_in_flight >= 2
    assert [source["source"] for source in result["sources"]] == [
        "Source for steel framing",
        "Source for prefab ADU",
        "Source for panelized walls",
    ]


@pytest.mark.anyio
async def test_search_web_node_charges_serper_only_for_successful_queries(monkeypatch):
    from api.rate_limiting.llm_usage import usage_accumulator_scope

    monkeypatch.setenv("SERPER_API_KEY", "test-key")

    async def fake_fetch_serper_results(*, api_key, queries, num_results):
        # Two queries issued, but only one succeeded and was returned/billed.
        return [{"results": []}]

    monkeypatch.setattr(
        finance_graph_module, "fetch_serper_results", fake_fetch_serper_results
    )

    state = {"search_queries": ["steel framing", "prefab ADU"], "sources": []}

    with usage_accumulator_scope() as accumulator:
        await search_web_node(state)
        snapshot = accumulator.snapshot()

    serper = [b for b in snapshot.breakdowns if b.provider == "serper"]
    assert len(serper) == 1
    assert serper[0].cost_micros == 1_000
    assert serper[0].route == "finance"
    assert serper[0].source == "finance.web_search"


@pytest.mark.anyio
async def test_research_node_plans_searches_and_builds_research_summary(monkeypatch):
    state = {
        "message": "Compare construction options",
        "history": [],
        "answer_safe_context": None,
        "finance_state": FinanceStateSnapshot(),
        "presentation": FinancePresentationInput(),
        "search_queries": [],
        "sources": [],
        "research_summary": "",
        "answer": "",
        "suggested_questions": [],
    }

    async def fake_plan_research_queries(input_state):
        assert input_state["message"] == state["message"]
        return ["steel framing", "prefab ADU"]

    async def fake_search_web_node(input_state):
        assert input_state["search_queries"] == ["steel framing", "prefab ADU"]
        return {
            **input_state,
            "sources": [
                {"source": "Steel source", "chunk_text": "Steel framing evidence"},
                {"source": "Prefab source", "chunk_text": "Prefab evidence"},
            ],
        }

    monkeypatch.setattr(
        finance_graph_module, "plan_research_queries", fake_plan_research_queries
    )
    monkeypatch.setattr(finance_graph_module, "search_web_node", fake_search_web_node)

    result = await research_node(state)

    assert result["search_queries"] == ["steel framing", "prefab ADU"]
    assert result["research_summary"] == ""
    assert [source["source"] for source in result["sources"]] == [
        "Steel source",
        "Prefab source",
    ]


@pytest.mark.anyio
async def test_stream_answer_text_ignores_usage_only_terminal_chunk_and_records_usage(
    monkeypatch,
):
    reconcile_calls: list[dict[str, object]] = []
    usage = SimpleNamespace(
        prompt_tokens=12,
        completion_tokens=8,
        total_tokens=20,
        prompt_tokens_details=SimpleNamespace(cached_tokens=0),
    )

    async def fake_stream():
        yield SimpleNamespace(
            id="gen-fin",
            choices=[SimpleNamespace(delta=SimpleNamespace(content="Costs vary. [1]"))],
            usage=None,
        )
        yield SimpleNamespace(id="gen-fin", choices=[], usage=usage)

    async def fake_acompletion(**kwargs):
        assert kwargs["stream"] is True
        assert kwargs["stream_options"] == {"include_usage": True}
        return fake_stream()

    def fake_record(**kwargs):
        reconcile_calls.append(kwargs)

    monkeypatch.setattr(finance_graph_module, "get_openrouter_key", lambda: "test-key")
    monkeypatch.setattr(
        litellm_client.litellm,
        "acompletion",
        fake_acompletion,
    )
    monkeypatch.setattr(
        finance_graph_module,
        "record_litellm_usage",
        fake_record,
    )

    state = {
        "message": "Compare construction options",
        "history": [],
        "answer_safe_context": None,
        "finance_state": FinanceStateSnapshot(),
        "presentation": FinancePresentationInput(),
        "search_queries": [],
        "sources": [],
        "research_summary": "",
        "answer": "",
        "suggested_questions": [],
    }

    chunks = []
    async for chunk in stream_answer_text(state):
        chunks.append(chunk)

    assert chunks == ["Costs vary. [1]"]
    # Cost is recorded from the streamed usage as a static estimate — no
    # post-stream generation-endpoint fetch.
    assert reconcile_calls == [
        {
            "model": finance_graph_module.FINANCE_MODEL,
            "usage": usage,
            "route": "finance",
            "source": "finance.stream_answer",
        }
    ]
