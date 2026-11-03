class _FailingEmbedModels:
    def embed_content(self, **kwargs):
        raise RuntimeError("embedding failed")


class _FailingEmbedClient:
    def __init__(self, api_key: str):
        self.models = _FailingEmbedModels()


def test_retriever_does_not_record_embedding_cost_on_failed_embed(monkeypatch):
    from RAG_pipeline.graph.nodes import retriever as retriever_mod
    from RAG_pipeline.graph.nodes.retriever import retriever_node
    from api.llm.tiers import FAST

    recorded = []
    captured = {}

    def fake_build_genai_client(*, tier, api_key):
        captured["tier"] = tier
        return _FailingEmbedClient(api_key)

    monkeypatch.setattr(retriever_mod, "get_api_key", lambda: "test-key")
    monkeypatch.setattr(retriever_mod, "build_genai_client", fake_build_genai_client)
    monkeypatch.setattr(
        retriever_mod,
        "record_embedding_estimate",
        lambda **kwargs: recorded.append(kwargs),
    )

    state = {"question": "What is an ADU?", "documents": []}
    result = retriever_node(state)

    assert result["documents"] == []
    assert recorded == []
    # The request-path embedding now goes through the resilient client (FAST tier).
    assert captured["tier"] is FAST


def test_embedding_breakdown_uses_estimated_tokens_in_accumulator():
    from api.rate_limiting.llm_usage import (
        record_embedding_estimate,
        usage_accumulator_scope,
    )

    with usage_accumulator_scope() as accumulator:
        record_embedding_estimate(
            model="gemini-embedding-001",
            char_count=99,
            route="rag",
            source="rag.retriever.embedding",
        )
        summary = accumulator.snapshot()

    assert summary.prompt_tokens == 33
    assert summary.total_tokens == 33
    assert summary.cost_micros == 5
    assert summary.is_estimated is True
    assert summary.breakdowns[0].provider == "gemini"


def test_embedding_direct_log_helper_persists_without_accumulator(monkeypatch):
    from api.rate_limiting.llm_usage import persist_embedding_estimate_direct

    calls = []
    monkeypatch.setattr(
        "api.rate_limiting.rate_limiter.record_direct_usage",
        lambda **kwargs: calls.append(kwargs),
    )

    breakdown = persist_embedding_estimate_direct(
        api_key_hash="hash",
        model="gemini-embedding-001",
        char_count=99,
        route="rag",
        source="rag.retriever.embedding",
        request_id="req-embed",
    )

    assert breakdown is not None
    assert calls == [
        {
            "api_key_hash": "hash",
            "tokens_used": 33,
            "model": "gemini-embedding-001",
            "request_id": "req-embed",
            "cost_micros": 5,
            "prompt_tokens": 33,
            "completion_tokens": 0,
            "total_tokens": 33,
            "cached_tokens": 0,
            "provider": "gemini",
            "route": "rag",
            "source": "rag.retriever.embedding",
            "is_estimated": True,
            "stream_terminated_early": False,
        }
    ]
