import logging
from types import SimpleNamespace

import httpx

from api.rate_limiting.llm_pricing import resolve_openrouter_cost_micros
from api.rate_limiting.llm_usage import (
    build_breakdown_from_langchain_message,
    build_breakdown_from_litellm_usage,
    record_openrouter_generation_cost,
    usage_accumulator_scope,
)


def test_resolve_cost_from_object_attr_ceils_to_micros():
    usage = SimpleNamespace(cost=0.000067268)
    assert resolve_openrouter_cost_micros(usage) == 68  # ceil(67.268)


def test_resolve_cost_from_mapping_key():
    assert resolve_openrouter_cost_micros({"cost": 0.0012}) == 1_200


def test_resolve_cost_ignores_cost_details_upstream_inference_cost():
    # upstream_inference_cost is the upstream provider's slice (BYOK), not what
    # OpenRouter bills the account, so it must NOT be used as the actual cost.
    # When top-level ``cost`` is absent we fall back to the static table (None).
    usage = SimpleNamespace(
        cost=None,
        cost_details=SimpleNamespace(upstream_inference_cost=0.0005),
    )
    assert resolve_openrouter_cost_micros(usage) is None


def test_resolve_cost_from_model_extra():
    usage = SimpleNamespace(model_extra={"cost": 0.00009})
    assert resolve_openrouter_cost_micros(usage) == 90


def test_resolve_cost_none_when_absent():
    assert resolve_openrouter_cost_micros(SimpleNamespace()) is None
    assert resolve_openrouter_cost_micros(None) is None
    assert resolve_openrouter_cost_micros({}) is None


def test_resolve_cost_none_when_zero_or_negative():
    assert resolve_openrouter_cost_micros({"cost": 0}) is None
    assert resolve_openrouter_cost_micros({"cost": -0.01}) is None


def test_resolve_cost_none_when_unparseable():
    assert resolve_openrouter_cost_micros({"cost": "free"}) is None


# ── LiteLLM cost-map registration (silences "model isn't mapped" log noise) ──


def test_importing_api_llm_registers_model_pricing_with_litellm():
    import api.llm  # noqa: F401  -- import side effect registers the model
    import litellm

    from api.rate_limiting.llm_pricing import LITELLM_CHAT_MODEL

    # The id LiteLLM uses for cost calc on this path must resolve (no exception),
    # so its internal cost calculator stops logging "model isn't mapped yet".
    info = litellm.get_model_info(LITELLM_CHAT_MODEL)
    assert info["input_cost_per_token"] == 140_000 / 1e12
    assert info["output_cost_per_token"] == 280_000 / 1e12


# ── Phase 1: LiteLLM recording path ──────────────────────────────────


def _litellm_usage(*, cost=None, prompt=1_000_000, completion=0, cached=0):
    return SimpleNamespace(
        prompt_tokens=prompt,
        completion_tokens=completion,
        total_tokens=prompt + completion,
        prompt_tokens_details=SimpleNamespace(cached_tokens=cached),
        cost=cost,
    )


def test_litellm_breakdown_uses_actual_cost():
    breakdown = build_breakdown_from_litellm_usage(
        model="deepseek-v4-flash",
        usage=_litellm_usage(cost=0.000067268, prompt=224, completion=139),
        route="rag",
        source="rag.generator.stream",
    )
    assert breakdown.cost_micros == 68
    assert breakdown.is_estimated is False
    assert breakdown.prompt_tokens == 224
    assert breakdown.completion_tokens == 139


def test_litellm_breakdown_falls_back_to_static(caplog):
    with caplog.at_level(logging.WARNING):
        breakdown = build_breakdown_from_litellm_usage(
            model="deepseek-v4-flash",
            usage=_litellm_usage(cost=None, prompt=1_000_000),
            route="rag",
            source="rag.generator.batch",
        )
    # static: 1M prompt * 140k/M = 140_000
    assert breakdown.cost_micros == 140_000
    assert breakdown.is_estimated is True
    assert any("static fallback" in r.message for r in caplog.records)


def test_litellm_breakdown_none_usage_returns_none():
    assert (
        build_breakdown_from_litellm_usage(
            model="deepseek-v4-flash", usage=None, route="rag", source="x"
        )
        is None
    )


# ── Phase 2: LangChain recording path ────────────────────────────────


def _lc_message(*, token_usage=None, prompt=224, completion=139, cached=0):
    response_metadata = {"model_name": "deepseek/deepseek-v4-flash"}
    if token_usage is not None:
        response_metadata["token_usage"] = token_usage
    return SimpleNamespace(
        usage_metadata={
            "input_tokens": prompt,
            "output_tokens": completion,
            "total_tokens": prompt + completion,
            "input_token_details": {"cache_read": cached},
        },
        response_metadata=response_metadata,
    )


def test_langchain_breakdown_uses_actual_cost():
    breakdown = build_breakdown_from_langchain_message(
        raw_message=_lc_message(token_usage={"cost": 0.000067268}),
        route="rag",
        source="rag.grader",
        model="deepseek-v4-flash",
    )
    assert breakdown.cost_micros == 68
    assert breakdown.is_estimated is False


def test_langchain_breakdown_falls_back_to_static(caplog):
    with caplog.at_level(logging.WARNING):
        breakdown = build_breakdown_from_langchain_message(
            raw_message=_lc_message(token_usage=None, prompt=1_000_000, completion=0),
            route="rag",
            source="rag.grader",
            model="deepseek-v4-flash",
        )
    assert breakdown.cost_micros == 140_000  # static: 1M * 140k/M
    assert breakdown.is_estimated is True
    assert any("static fallback" in r.message for r in caplog.records)


def test_langchain_breakdown_none_when_no_usage_metadata():
    assert (
        build_breakdown_from_langchain_message(
            raw_message=SimpleNamespace(usage_metadata=None),
            route="rag",
            source="x",
            model="deepseek-v4-flash",
        )
        is None
    )


# ── Phase 3: streaming generation-endpoint reconciliation ────────────
#
# Streamed OpenRouter calls never return ``cost`` on the usage payload, so the
# actual billed cost is fetched after the stream from GET /api/v1/generation.


async def _no_sleep(_seconds):
    return None


def _mock_client(responses):
    """httpx.AsyncClient backed by a MockTransport that serves ``responses``
    (a list of ``(status, json_payload)``) in order, repeating the last."""
    state = {"calls": 0}

    def handler(request):
        i = state["calls"]
        state["calls"] += 1
        status, payload = responses[min(i, len(responses) - 1)]
        return httpx.Response(status, json=payload)

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return client, state


def _gen(total_cost):
    return {"data": {"total_cost": total_cost}}


async def test_generation_cost_records_actual_on_first_try(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    client, state = _mock_client([(200, _gen(0.000067268))])
    with usage_accumulator_scope() as acc:
        breakdown = await record_openrouter_generation_cost(
            gen_id="gen-abc",
            model="deepseek-v4-flash",
            usage=_litellm_usage(cost=None, prompt=224, completion=139),
            route="rag",
            source="rag.generator.stream",
            client=client,
            sleep=_no_sleep,
        )
    assert state["calls"] == 1
    assert breakdown.cost_micros == 68  # ceil(67.268), the billed total_cost
    assert breakdown.is_estimated is False
    assert breakdown.prompt_tokens == 224
    assert breakdown.completion_tokens == 139
    # recorded into the active accumulator
    assert acc.snapshot().breakdowns[-1].cost_micros == 68


async def test_generation_cost_retries_until_settled(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    # cost not settled on the first call (404), then available.
    client, state = _mock_client([(404, {}), (200, _gen(0.0012))])
    breakdown = await record_openrouter_generation_cost(
        gen_id="gen-abc",
        model="deepseek-v4-flash",
        usage=_litellm_usage(cost=None, prompt=224, completion=139),
        route="rag",
        source="rag.generator.stream",
        client=client,
        sleep=_no_sleep,
    )
    assert state["calls"] == 2
    assert breakdown.cost_micros == 1_200
    assert breakdown.is_estimated is False


async def test_generation_cost_falls_back_to_estimate_when_endpoint_fails(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    client, state = _mock_client([(404, {})])  # never settles
    breakdown = await record_openrouter_generation_cost(
        gen_id="gen-abc",
        model="deepseek-v4-flash",
        usage=_litellm_usage(cost=None, prompt=1_000_000, completion=0),
        route="rag",
        source="rag.generator.stream",
        client=client,
        sleep=_no_sleep,
    )
    assert state["calls"] > 1  # exhausted retries
    assert breakdown.cost_micros == 140_000  # static: 1M prompt * 140k/M
    assert breakdown.is_estimated is True


async def test_generation_cost_no_gen_id_uses_estimate(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    client, state = _mock_client([(200, _gen(0.0012))])
    breakdown = await record_openrouter_generation_cost(
        gen_id=None,
        model="deepseek-v4-flash",
        usage=_litellm_usage(cost=None, prompt=1_000_000, completion=0),
        route="rag",
        source="rag.generator.stream",
        client=client,
        sleep=_no_sleep,
    )
    assert state["calls"] == 0  # no HTTP call without an id
    assert breakdown.cost_micros == 140_000
    assert breakdown.is_estimated is True
