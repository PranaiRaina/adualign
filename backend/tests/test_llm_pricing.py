import pytest

from api.rate_limiting.llm_pricing import (
    CHAT_COMPLETION_MODEL,
    DEFAULT_EMBEDDING_MODEL,
    DEFAULT_REASONING_LEVEL,
    REASONING_MEDIUM,
    REASONING_MINIMAL,
    ROUTE_DEFAULT_RESERVATIONS_MICROS,
    UnknownModelPricingError,
    compute_text_generation_cost_micros,
    estimate_embedding_cost_micros,
    normalize_embedding_model,
    normalize_generation_model,
    reasoning_kwargs,
)


def test_chat_model_id_is_deepseek_v4_flash():
    assert CHAT_COMPLETION_MODEL == "deepseek-v4-flash"


def test_compute_chat_model_cost_micros_exact():
    # deepseek-v4-flash: input 140k, output 280k, cache_read 70k micros/MTok.
    # 900k uncached prompt + 1M completion + 100k cached
    assert (
        compute_text_generation_cost_micros(
            CHAT_COMPLETION_MODEL,
            prompt_tokens=1_000_000,
            completion_tokens=1_000_000,
            cached_tokens=100_000,
        )
        == 126_000 + 280_000 + 7_000
    )


def test_embedding_001_cost_uses_token_pricing():
    assert DEFAULT_EMBEDDING_MODEL == "gemini-embedding-001"
    assert estimate_embedding_cost_micros("gemini-embedding-001", 3_000_000) == 150_000
    assert estimate_embedding_cost_micros("gemini-embedding-001", 1) == 1


def test_normalize_generation_model_resolves_provider_prefixes():
    assert (
        normalize_generation_model("openrouter/deepseek/deepseek-v4-flash")
        == CHAT_COMPLETION_MODEL
    )
    assert (
        normalize_generation_model("deepseek/deepseek-v4-flash")
        == CHAT_COMPLETION_MODEL
    )


def test_normalize_generation_model_collapses_dated_openrouter_variants():
    # OpenRouter echoes dated ids like deepseek/deepseek-v4-flash-20260423.
    assert (
        normalize_generation_model("deepseek/deepseek-v4-flash-20260423")
        == CHAT_COMPLETION_MODEL
    )


def test_gemini_is_only_allowed_for_embeddings():
    with pytest.raises(UnknownModelPricingError):
        normalize_generation_model("gemini-2.5-flash-lite")
    assert normalize_embedding_model("gemini-embedding-001") == "gemini-embedding-001"


def test_unknown_generation_model_fails_closed_for_costing():
    with pytest.raises(UnknownModelPricingError):
        normalize_generation_model("gemma-4-26b-a4b-it")


def test_reasoning_kwargs_defaults_to_medium_object():
    kwargs = reasoning_kwargs()
    provider = kwargs["extra_body"]["provider"]
    assert kwargs["extra_body"]["reasoning"] == {"effort": "medium"}
    assert provider["only"][0] == "gmicloud"
    assert set(provider["only"]) == {
        "gmicloud",
        "alibaba",
        "atlas-cloud",
        "cloudflare",
        "fireworks",
        "morph",
        "parasail",
        "streamlake",
        "venice",
    }
    assert provider["sort"] == "throughput"
    assert DEFAULT_REASONING_LEVEL == REASONING_MEDIUM == "medium"


def test_reasoning_kwargs_minimal_level_disables_reasoning():
    kwargs = reasoning_kwargs(REASONING_MINIMAL)
    assert kwargs["extra_body"]["reasoning"] == {"enabled": False}


def test_openrouter_extra_body_opts_into_usage_reporting():
    from api.rate_limiting.llm_pricing import openrouter_extra_body

    body = openrouter_extra_body()
    assert body["usage"] == {"include": True}
    assert body["reasoning"] == {"effort": DEFAULT_REASONING_LEVEL}
    assert "provider" in body


def test_reasoning_kwargs_carries_usage_include():
    body = reasoning_kwargs()["extra_body"]
    assert body["usage"] == {"include": True}


def test_route_default_reservations_match_prd():
    assert ROUTE_DEFAULT_RESERVATIONS_MICROS == {
        "rag": 6_000,
        "finance": 15_000,
        "guardrail": 200,
        "orchestrator": 500,
        "editor": 6_000,
    }
