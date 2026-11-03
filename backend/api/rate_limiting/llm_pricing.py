"""LLM pricing and reservation constants for cost accounting.

Chat runs on OpenRouter (deepseek-v4-flash); embeddings stay on Gemini
(gemini-embedding-001).
"""

from __future__ import annotations

import math
from typing import Any

# The primary chat provider. Embeddings remain on Gemini and are attributed
# separately so provider-level usage reports reconcile with each vendor.
DEFAULT_LLM_PROVIDER = "openrouter"
EMBEDDING_PROVIDER = "gemini"

# External (non-LLM) API pricing, tracked alongside LLM usage. Serper bills one
# credit per search request at $0.001 == 1000 micros (USD millionths).
SERPER_PROVIDER = "serper"
SERPER_COST_MICROS = 1_000

# Canonical id for all text chat / completion traffic (not embeddings). Chat is
# served by deepseek-v4-flash via OpenRouter; embeddings stay on Gemini (below).
CHAT_COMPLETION_MODEL = "deepseek-v4-flash"
# LiteLLM provider-prefixed id.
LITELLM_CHAT_MODEL = "openrouter/deepseek/deepseek-v4-flash"
# For the OpenAI-compatible (ChatOpenAI) path pointed at OpenRouter's endpoint.
OPENROUTER_CHAT_MODEL = "deepseek/deepseek-v4-flash"
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

# deepseek-v4-flash is a reasoning model; reasoning is driven via OpenRouter's
# ``reasoning`` object. Default to medium for the final answer calls; the
# intermediate RAG/finance nodes pass REASONING_MINIMAL, which disables
# reasoning entirely (deepseek-v4-flash is hybrid, so non-thinking mode works).
REASONING_MEDIUM = "medium"
REASONING_MINIMAL = "off"
DEFAULT_REASONING_LEVEL = REASONING_MEDIUM

# OpenRouter spreads deepseek-v4-flash across ~18 provider backends with
# inconsistent behavior: several advertise structured-output support but return
# prose or *empty* content in practice (verified bad: DeepInfra, DigitalOcean,
# WandB), and some reject json_schema outright (Novita 400). Pin routing to the
# providers empirically verified to honor json_schema and return non-empty
# content, so both structured-output classifier calls and plain-text streaming
# stay reliable. ``sort: "throughput"`` makes OpenRouter try the fastest
# (tokens/sec) provider in the allowlist first — cheap hosts were too slow for
# chat; ``allow_fallbacks`` only ever falls back *within* this allowlist — it
# never reaches an unverified provider. gmicloud is listed first
# by request; note it advertises no structured-output support and hard-rejects
# json_schema with a non-retryable 400 ~1 in 7 calls.
OPENROUTER_PROVIDER_ALLOWLIST = [
    "gmicloud",
    "alibaba",
    "atlas-cloud",
    "cloudflare",
    "fireworks",
    "morph",
    "parasail",
    "streamlake",
    "venice",
]
OPENROUTER_PROVIDER_ROUTING = {
    "only": OPENROUTER_PROVIDER_ALLOWLIST,
    "sort": "throughput",
    "allow_fallbacks": True,
}

DEFAULT_GENERATION_MODEL = CHAT_COMPLETION_MODEL
DEFAULT_LITE_GENERATION_MODEL = CHAT_COMPLETION_MODEL
DEFAULT_EMBEDDING_MODEL = "gemini-embedding-001"

ROLLING_AVG_MIN_SAMPLES = 10
ROLLING_AVG_BUFFER_MULTIPLIER = 1.2
ROLLING_AVG_VERSION = "2026-06-28-deepseek-v4-flash-cost-accounting-v1"

# Provider list rates for cost_display. Chat = OpenRouter deepseek-v4-flash;
# embeddings = Gemini.
LLM_PRICING: dict[str, dict[str, int]] = {
    CHAT_COMPLETION_MODEL: {
        "input_micros_per_million_tokens": 140_000,
        "output_micros_per_million_tokens": 280_000,
        "cache_read_micros_per_million_tokens": 70_000,
    },
    DEFAULT_EMBEDDING_MODEL: {
        "input_micros_per_million_tokens": 150_000,
    },
}

ROUTE_DEFAULT_RESERVATIONS_MICROS = {
    "rag": 6_000,
    "finance": 15_000,
    "guardrail": 200,
    "orchestrator": 500,
    "editor": 6_000,
}

_MODEL_ALIASES = {
    "openrouter/deepseek/deepseek-v4-flash": CHAT_COMPLETION_MODEL,
    "deepseek/deepseek-v4-flash": CHAT_COMPLETION_MODEL,
    "models/gemini-embedding-001": DEFAULT_EMBEDDING_MODEL,
}

ALLOWED_GENERATION_MODELS = frozenset({CHAT_COMPLETION_MODEL})


class UnknownModelPricingError(ValueError):
    """Raised when cost accounting sees a generation model without pricing."""


def openrouter_extra_body(level: str = DEFAULT_REASONING_LEVEL) -> dict[str, Any]:
    """OpenRouter request-body extras: reasoning control + provider routing.

    deepseek-v4-flash is a reasoning model. ``level`` is an effort string
    (``"medium"`` default) or ``REASONING_MINIMAL`` (``"off"``), which disables
    reasoning via ``{"enabled": false}``; the object form is used because the
    model advertises ``reasoning`` rather than the flat ``reasoning_effort``
    field. Provider routing pins the request to the verified
    allowlist (see ``OPENROUTER_PROVIDER_ROUTING``). Used by the ChatOpenAI path
    (as ``extra_body``) and, wrapped by :func:`reasoning_kwargs`, the LiteLLM path.

    ``usage: {include: true}`` makes OpenRouter return the actual call cost on the
    usage payload, which cost accounting prefers over the static price table."""
    reasoning: dict[str, Any] = (
        {"enabled": False} if level == REASONING_MINIMAL else {"effort": level}
    )
    return {
        "reasoning": reasoning,
        "provider": dict(OPENROUTER_PROVIDER_ROUTING),
        "usage": {"include": True},
    }


def reasoning_kwargs(level: str = DEFAULT_REASONING_LEVEL) -> dict[str, Any]:
    """LiteLLM call kwargs carrying the OpenRouter extras in ``extra_body``.

    LiteLLM forwards ``extra_body`` verbatim into the OpenRouter request, so this
    is how the LiteLLM path (``acompletion_resilient`` / ``astream_resilient``)
    gets the same reasoning + provider routing as the ChatOpenAI path."""
    return {"extra_body": openrouter_extra_body(level)}


def normalize_model_name(model: str | None) -> str:
    if not model:
        return DEFAULT_GENERATION_MODEL
    normalized = model.strip()
    if normalized in _MODEL_ALIASES:
        return _MODEL_ALIASES[normalized]
    # OpenRouter can echo back dated / provider-suffixed ids such as
    # "deepseek/deepseek-v4-flash-20260423"; collapse any deepseek-v4-flash
    # variant to the canonical chat model id so cost accounting still resolves.
    if "deepseek-v4-flash" in normalized:
        return CHAT_COMPLETION_MODEL
    return normalized


_GENERATION_PRICING_KEYS = ALLOWED_GENERATION_MODELS & frozenset(LLM_PRICING)


def normalize_generation_model(model: str | None) -> str:
    normalized = normalize_model_name(model)
    if (
        normalized in ALLOWED_GENERATION_MODELS
        and normalized in _GENERATION_PRICING_KEYS
    ):
        return normalized
    raise UnknownModelPricingError(
        f"No generation pricing configured for model {normalized!r}"
    )


def normalize_embedding_model(model: str | None) -> str:
    normalized = normalize_model_name(model)
    if normalized == DEFAULT_EMBEDDING_MODEL:
        return normalized
    return DEFAULT_EMBEDDING_MODEL


def compute_text_generation_cost_micros(
    model: str | None,
    prompt_tokens: int,
    completion_tokens: int,
    cached_tokens: int = 0,
) -> int:
    normalized_model = normalize_generation_model(model)
    pricing = LLM_PRICING[normalized_model]

    safe_prompt_tokens = max(prompt_tokens, 0)
    safe_completion_tokens = max(completion_tokens, 0)
    safe_cached_tokens = min(max(cached_tokens, 0), safe_prompt_tokens)
    uncached_prompt_tokens = max(safe_prompt_tokens - safe_cached_tokens, 0)

    prompt_cost = math.ceil(
        uncached_prompt_tokens * pricing["input_micros_per_million_tokens"] / 1_000_000
    )
    completion_cost = math.ceil(
        safe_completion_tokens * pricing["output_micros_per_million_tokens"] / 1_000_000
    )
    cache_read_cost = math.ceil(
        safe_cached_tokens * pricing["cache_read_micros_per_million_tokens"] / 1_000_000
    )
    return int(prompt_cost + completion_cost + cache_read_cost)


def _usd_cost_from_source(source: Any) -> float | None:
    """Pull OpenRouter's USD cost from a usage object (attrs) or mapping (keys).

    OpenRouter reports the amount it bills the account on the usage payload as
    top-level ``cost`` (USD). LiteLLM hands back a usage *object*; the LangChain
    path hands back a ``token_usage`` *dict*. This reads either shape and
    tolerates the field being absent.

    We deliberately do *not* fall back to ``cost_details.upstream_inference_cost``:
    that is only the upstream provider's slice (BYOK), excludes OpenRouter's
    markup, and is not what the account is billed — recording it would silently
    under-report spend. When ``cost`` is absent, callers fall back to the static
    price table instead.
    """
    if source is None:
        return None

    def _get(obj: Any, key: str) -> Any:
        if isinstance(obj, dict):
            return obj.get(key)
        return getattr(obj, key, None)

    cost = _get(source, "cost")
    if cost is None:
        extra = _get(source, "model_extra")
        if isinstance(extra, dict):
            cost = extra.get("cost")

    if cost is None:
        return None
    try:
        return float(cost)
    except (TypeError, ValueError):
        return None


def resolve_openrouter_cost_micros(source: Any) -> int | None:
    """OpenRouter actual cost in micros, or None if absent / non-positive.

    None signals callers to fall back to the static price table.
    """
    usd = _usd_cost_from_source(source)
    if usd is None:
        return None
    micros = math.ceil(usd * 1_000_000)
    return micros if micros > 0 else None


def estimate_embedding_tokens(char_count: int) -> int:
    return int(math.ceil(max(char_count, 0) / 3))


def compute_embedding_cost_micros(model: str | None, input_tokens: int) -> int:
    normalized_model = normalize_embedding_model(model)
    pricing = LLM_PRICING[normalized_model]
    return int(
        math.ceil(
            max(input_tokens, 0)
            * pricing["input_micros_per_million_tokens"]
            / 1_000_000
        )
    )


def estimate_embedding_cost_micros(model: str | None, char_count: int) -> int:
    return compute_embedding_cost_micros(
        model,
        estimate_embedding_tokens(char_count),
    )


def default_reservation_for_route(route: str) -> int:
    return ROUTE_DEFAULT_RESERVATIONS_MICROS.get(
        route.lower(), ROUTE_DEFAULT_RESERVATIONS_MICROS["rag"]
    )
