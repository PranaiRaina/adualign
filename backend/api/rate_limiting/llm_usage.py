"""Request-scoped LLM and external-API usage accounting helpers."""

from __future__ import annotations

import asyncio
from contextlib import contextmanager
from contextvars import ContextVar, Token
from dataclasses import dataclass, field
import logging
from threading import Lock
from typing import Any

import httpx

from api.rate_limiting.llm_pricing import (
    DEFAULT_LLM_PROVIDER,
    EMBEDDING_PROVIDER,
    OPENROUTER_BASE_URL,
    SERPER_COST_MICROS,
    SERPER_PROVIDER,
    compute_embedding_cost_micros,
    compute_text_generation_cost_micros,
    estimate_embedding_tokens,
    normalize_embedding_model,
    normalize_generation_model,
    resolve_openrouter_cost_micros,
)
from api.http_client import shared_async_client
from api.utils import get_openrouter_key

FINANCE_TURN_LOG_TAG = "[finance-chat-turn]"
RAG_TURN_LOG_TAG = "[rag-chat-turn]"
GUIDED_REQUIREMENTS_LOG_TAG = "[guided-requirements-turn]"
REPORT_GENERATION_LOG_TAG = "[report-generation]"

logger = logging.getLogger(__name__)

_CURRENT_USAGE_ACCUMULATOR: ContextVar["LLMUsageAccumulator | None"] = ContextVar(
    "current_llm_usage_accumulator",
    default=None,
)


def label_models(models) -> str:
    """Collapse a set of model names to one, ``"multiple"``, or ``"unknown"``."""
    unique = {model for model in models if model}
    if len(unique) == 1:
        return next(iter(unique))
    if len(unique) > 1:
        return "multiple"
    return "unknown"


def label_sources(sources) -> str | None:
    """Collapse a set of source names to one, ``"multiple"``, or ``None``."""
    unique = {source for source in sources if source}
    if len(unique) == 1:
        return next(iter(unique))
    if len(unique) > 1:
        return "multiple"
    return None


@dataclass(frozen=True)
class LLMUsageBreakdown:
    model: str
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    cached_tokens: int
    cost_micros: int
    is_estimated: bool
    route: str
    source: str
    provider: str = DEFAULT_LLM_PROVIDER


@dataclass(frozen=True)
class LLMUsageSummary:
    model: str
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    cached_tokens: int
    cost_micros: int
    is_estimated: bool
    breakdowns: list[LLMUsageBreakdown]


@dataclass
class LLMUsageAccumulator:
    """Thread-safe request-scoped collector for provider usage."""

    _lock: Lock = field(default_factory=Lock)
    _breakdowns: list[LLMUsageBreakdown] = field(default_factory=list)

    def add_breakdown(self, breakdown: LLMUsageBreakdown) -> None:
        with self._lock:
            self._breakdowns.append(breakdown)

    def breakdown_count(self) -> int:
        with self._lock:
            return len(self._breakdowns)

    def snapshot(self, *, since: int = 0) -> LLMUsageSummary:
        with self._lock:
            breakdowns = list(self._breakdowns[since:])

        prompt_tokens = sum(item.prompt_tokens for item in breakdowns)
        completion_tokens = sum(item.completion_tokens for item in breakdowns)
        total_tokens = sum(item.total_tokens for item in breakdowns)
        cached_tokens = sum(item.cached_tokens for item in breakdowns)
        cost_micros = sum(item.cost_micros for item in breakdowns)
        has_estimate = any(item.is_estimated for item in breakdowns)

        return LLMUsageSummary(
            model=label_models(item.model for item in breakdowns),
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            cached_tokens=cached_tokens,
            cost_micros=cost_micros,
            is_estimated=has_estimate,
            breakdowns=breakdowns,
        )


def get_current_usage_accumulator() -> LLMUsageAccumulator | None:
    return _CURRENT_USAGE_ACCUMULATOR.get()


def set_current_usage_accumulator(
    accumulator: LLMUsageAccumulator | None,
) -> Token[LLMUsageAccumulator | None]:
    return _CURRENT_USAGE_ACCUMULATOR.set(accumulator)


def reset_current_usage_accumulator(
    token: Token[LLMUsageAccumulator | None],
) -> None:
    _CURRENT_USAGE_ACCUMULATOR.reset(token)


@contextmanager
def usage_accumulator_scope(accumulator: LLMUsageAccumulator | None = None):
    active_accumulator = accumulator or LLMUsageAccumulator()
    token = set_current_usage_accumulator(active_accumulator)
    try:
        yield active_accumulator
    finally:
        reset_current_usage_accumulator(token)


def record_usage_breakdown(breakdown: LLMUsageBreakdown) -> LLMUsageBreakdown:
    accumulator = get_current_usage_accumulator()
    if accumulator is not None:
        accumulator.add_breakdown(breakdown)
    return breakdown


def record_serper_usage(
    *,
    num_calls: int,
    route: str,
    source: str,
) -> LLMUsageBreakdown | None:
    """Record Serper external-search cost into the request usage accumulator.

    One row's worth of cost is ``num_calls * SERPER_COST_MICROS``. Returns None
    (recording nothing) when no calls were made, so callers can pass the query
    count unconditionally.
    """
    if num_calls <= 0:
        return None

    if get_current_usage_accumulator() is None:
        # Serper incurs real spend; without an accumulator the cost is dropped,
        # so make the gap loud instead of silently under-counting.
        logger.warning(
            "Serper usage recorded with no active usage accumulator; "
            "%d call(s) of cost will not be tracked (route=%s source=%s)",
            num_calls,
            route,
            source,
        )

    breakdown = LLMUsageBreakdown(
        model=SERPER_PROVIDER,
        provider=SERPER_PROVIDER,
        prompt_tokens=0,
        completion_tokens=0,
        total_tokens=0,
        cached_tokens=0,
        cost_micros=num_calls * SERPER_COST_MICROS,
        is_estimated=False,
        route=route,
        source=source,
    )
    return record_usage_breakdown(breakdown)


def _cost_micros_and_estimated(
    *,
    cost_source: Any,
    normalized_model: str,
    prompt_tokens: int,
    completion_tokens: int,
    cached_tokens: int,
    fallback_origin: str,
) -> tuple[int, bool]:
    """Resolve the OpenRouter actual cost, or fall back to the static price table.

    Returns ``(cost_micros, is_estimated)``. ``is_estimated`` is ``False`` when
    OpenRouter reported the call's cost on ``cost_source``; otherwise the static
    table is used and a warning is logged. ``fallback_origin`` names the path for
    that warning (e.g. ``"LangChain message"`` / ``"LiteLLM usage"``).
    """
    actual_cost_micros = resolve_openrouter_cost_micros(cost_source)
    if actual_cost_micros is not None:
        return actual_cost_micros, False
    logger.warning(
        "No OpenRouter cost on %s for %s; using static fallback",
        fallback_origin,
        normalized_model,
    )
    return (
        compute_text_generation_cost_micros(
            normalized_model,
            prompt_tokens,
            completion_tokens,
            cached_tokens,
        ),
        True,
    )


def build_breakdown_from_langchain_message(
    *,
    raw_message: Any,
    route: str,
    source: str,
    model: str | None,
) -> LLMUsageBreakdown | None:
    usage_metadata = getattr(raw_message, "usage_metadata", None)
    if not usage_metadata:
        return None

    prompt_tokens = int(usage_metadata.get("input_tokens", 0) or 0)
    completion_tokens = int(usage_metadata.get("output_tokens", 0) or 0)
    total_tokens = int(
        usage_metadata.get("total_tokens", prompt_tokens + completion_tokens) or 0
    )
    input_details = usage_metadata.get("input_token_details") or {}
    cached_tokens = int(input_details.get("cache_read", 0) or 0)

    response_metadata = getattr(raw_message, "response_metadata", {}) or {}
    normalized_model = normalize_generation_model(
        response_metadata.get("model_name") or model
    )
    cost_micros, is_estimated = _cost_micros_and_estimated(
        cost_source=response_metadata.get("token_usage"),
        normalized_model=normalized_model,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        cached_tokens=cached_tokens,
        fallback_origin="LangChain message",
    )
    return LLMUsageBreakdown(
        model=normalized_model,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=total_tokens,
        cached_tokens=cached_tokens,
        cost_micros=cost_micros,
        is_estimated=is_estimated,
        route=route,
        source=source,
    )


def record_langchain_usage(
    *,
    raw_message: Any,
    route: str,
    source: str,
    model: str | None,
) -> LLMUsageBreakdown | None:
    breakdown = build_breakdown_from_langchain_message(
        raw_message=raw_message,
        route=route,
        source=source,
        model=model,
    )
    if breakdown is None:
        return None
    return record_usage_breakdown(breakdown)


def _litellm_usage_tokens(usage: Any) -> tuple[int, int, int, int]:
    """``(prompt, completion, total, cached)`` token counts off a LiteLLM usage."""
    prompt_tokens = int(getattr(usage, "prompt_tokens", 0) or 0)
    completion_tokens = int(getattr(usage, "completion_tokens", 0) or 0)
    total_tokens = int(
        getattr(usage, "total_tokens", prompt_tokens + completion_tokens) or 0
    )
    prompt_details = getattr(usage, "prompt_tokens_details", None)
    cached_tokens = int(getattr(prompt_details, "cached_tokens", 0) or 0)
    return prompt_tokens, completion_tokens, total_tokens, cached_tokens


def build_breakdown_from_litellm_usage(
    *,
    model: str | None,
    usage: Any,
    route: str,
    source: str,
) -> LLMUsageBreakdown | None:
    if usage is None:
        return None

    prompt_tokens, completion_tokens, total_tokens, cached_tokens = (
        _litellm_usage_tokens(usage)
    )

    normalized_model = normalize_generation_model(model)
    cost_micros, is_estimated = _cost_micros_and_estimated(
        cost_source=usage,
        normalized_model=normalized_model,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        cached_tokens=cached_tokens,
        fallback_origin="LiteLLM usage",
    )
    return LLMUsageBreakdown(
        model=normalized_model,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=total_tokens,
        cached_tokens=cached_tokens,
        cost_micros=cost_micros,
        is_estimated=is_estimated,
        route=route,
        source=source,
    )


def record_litellm_usage(
    *,
    model: str | None,
    usage: Any,
    route: str,
    source: str,
) -> LLMUsageBreakdown | None:
    breakdown = build_breakdown_from_litellm_usage(
        model=model,
        usage=usage,
        route=route,
        source=source,
    )
    if breakdown is None:
        return None
    return record_usage_breakdown(breakdown)


# ── Streamed-call cost reconciliation via the generation endpoint ────
#
# Streamed OpenRouter responses never carry ``cost`` on the usage payload (only
# non-streaming and the generation endpoint do), so streamed cost must be read
# back afterwards from GET /api/v1/generation.

_GENERATION_COST_ENDPOINT = f"{OPENROUTER_BASE_URL}/generation"
_GENERATION_COST_TIMEOUT_S = 15.0
# Waits between successive fetch attempts; cost settles ~5s after the stream ends
# (measured live), so the schedule extends to ~7s to catch slow settles before
# falling back to the estimate. The loop returns as soon as cost is found, so the
# typical wait stays ~5s — the wider tail only helps slow-settling turns.
# len(delays) + 1 attempts → fetches at t≈0, 0.8, 2.3, 4.8, 7.0s.
# ponytail: fixed schedule, not exponential — the settle time is bounded and known.
_GENERATION_COST_RETRY_DELAYS_S = (0.8, 1.5, 2.5, 2.2)


async def _fetch_openrouter_generation_cost_micros(
    client: httpx.AsyncClient, gen_id: str
) -> int | None:
    """One GET against the generation endpoint → billed cost micros, or None.

    Returns None on a non-200 (404 = cost not settled yet), a transport error,
    or when ``total_cost`` is absent/non-positive — the caller retries or falls
    back to the static estimate.
    """
    try:
        response = await client.get(
            _GENERATION_COST_ENDPOINT,
            params={"id": gen_id},
            headers={"Authorization": f"Bearer {get_openrouter_key()}"},
            timeout=_GENERATION_COST_TIMEOUT_S,
        )
    except httpx.HTTPError:
        return None
    if response.status_code != 200:
        return None
    data = response.json().get("data") or {}
    # total_cost is what OpenRouter billed the account for this generation —
    # the authoritative figure, above the upstream-only number on usage.cost.
    return resolve_openrouter_cost_micros({"cost": data.get("total_cost")})


async def record_openrouter_generation_cost(
    *,
    gen_id: str | None,
    model: str | None,
    usage: Any,
    route: str,
    source: str,
    client: httpx.AsyncClient | None = None,
    sleep=asyncio.sleep,
) -> LLMUsageBreakdown | None:
    """Record the *actual* billed cost for a streamed OpenRouter call.

    Fetches the settled cost from the generation endpoint (with a short retry).
    Falls back to the static estimate (:func:`record_litellm_usage`) when there
    is no id or the cost never settles, so spend is never dropped. ``client`` and
    ``sleep`` are injectable for testing.
    """
    actual_cost_micros: int | None = None
    if gen_id:
        if client is None:
            client = shared_async_client()
        for delay in (*_GENERATION_COST_RETRY_DELAYS_S, None):
            actual_cost_micros = await _fetch_openrouter_generation_cost_micros(
                client, gen_id
            )
            if actual_cost_micros is not None:
                break
            if delay is not None:
                await sleep(delay)

    if actual_cost_micros is None:
        # No id, or cost never settled — keep today's static-estimate behavior.
        logger.warning(
            "No settled OpenRouter cost for gen_id=%s (%s); using static fallback",
            gen_id,
            source,
        )
        return record_litellm_usage(
            model=model, usage=usage, route=route, source=source
        )

    prompt_tokens, completion_tokens, total_tokens, cached_tokens = (
        _litellm_usage_tokens(usage)
    )
    return record_usage_breakdown(
        LLMUsageBreakdown(
            model=normalize_generation_model(model),
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            cached_tokens=cached_tokens,
            cost_micros=actual_cost_micros,
            is_estimated=False,
            route=route,
            source=source,
        )
    )


def get_route_usage_summary(
    route: str,
    *,
    since: int = 0,
) -> LLMUsageSummary | None:
    """Aggregate usage breakdowns for a single route since a baseline index."""
    accumulator = get_current_usage_accumulator()
    if accumulator is None:
        return None

    snapshot = accumulator.snapshot(since=since)
    normalized_route = route.lower()
    breakdowns = [
        item for item in snapshot.breakdowns if item.route.lower() == normalized_route
    ]
    if not breakdowns:
        return None

    prompt_tokens = sum(item.prompt_tokens for item in breakdowns)
    completion_tokens = sum(item.completion_tokens for item in breakdowns)
    total_tokens = sum(item.total_tokens for item in breakdowns)
    cached_tokens = sum(item.cached_tokens for item in breakdowns)
    cost_micros = sum(item.cost_micros for item in breakdowns)
    has_estimate = any(item.is_estimated for item in breakdowns)

    return LLMUsageSummary(
        model=label_models(item.model for item in breakdowns),
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=total_tokens,
        cached_tokens=cached_tokens,
        cost_micros=cost_micros,
        is_estimated=has_estimate,
        breakdowns=breakdowns,
    )


def log_finance_turn_usage(
    *,
    prompt: str,
    since: int = 0,
) -> None:
    """Print per-turn finance LLM tokens and cost to stdout (temporary)."""
    log_route_turn_usage(
        route="finance",
        tag=FINANCE_TURN_LOG_TAG,
        prompt=prompt,
        since=since,
    )


def log_rag_turn_usage(
    *,
    prompt: str,
    since: int = 0,
) -> None:
    """Log per-turn RAG LLM tokens and cost."""
    log_route_turn_usage(
        route="rag",
        tag=RAG_TURN_LOG_TAG,
        prompt=prompt,
        since=since,
    )


def log_guided_requirements_turn_usage(
    *,
    project_id: str,
    question_id: str,
    answer_source: str,
    status: str,
    llm_used: bool,
    reason: str | None = None,
    since: int = 0,
) -> None:
    """Log guided requirement answer token usage."""
    tag = GUIDED_REQUIREMENTS_LOG_TAG
    base_extra = {
        "tag": tag,
        "project_id": project_id,
        "question_id": question_id,
        "answer_source": answer_source,
        "status": status,
        "reason": reason,
    }

    if not llm_used:
        logger.info(
            "Guided requirement turn completed without LLM",
            extra={**base_extra, "usage_status": "no_llm"},
        )
        return

    accumulator = get_current_usage_accumulator()
    if accumulator is None:
        logger.warning(
            "Guided requirement turn missing usage accumulator",
            extra={**base_extra, "usage_status": "no_accumulator"},
        )
        return

    snapshot = accumulator.snapshot(since=since)
    validation_breakdowns = [
        item
        for item in snapshot.breakdowns
        if item.source == "reports.validate_requirement_answer"
    ]
    breakdowns = validation_breakdowns or snapshot.breakdowns

    if not breakdowns:
        logger.warning(
            "Guided requirement turn used LLM but recorded no breakdowns",
            extra={**base_extra, "usage_status": "no_breakdowns"},
        )
        return

    prompt_tokens = sum(item.prompt_tokens for item in breakdowns)
    completion_tokens = sum(item.completion_tokens for item in breakdowns)
    total_tokens = sum(item.total_tokens for item in breakdowns)
    cached_tokens = sum(item.cached_tokens for item in breakdowns)
    cost_micros = sum(item.cost_micros for item in breakdowns)
    has_estimate = any(item.is_estimated for item in breakdowns)
    model = label_models(item.model for item in breakdowns)

    cost_usd = cost_micros / 1_000_000
    logger.info(
        "Guided requirement turn usage recorded",
        extra={
            **base_extra,
            "usage_status": "recorded",
            "model": model,
            "input_tokens": prompt_tokens,
            "output_tokens": completion_tokens,
            "cached_tokens": cached_tokens,
            "total_tokens": total_tokens,
            "cost_usd": round(cost_usd, 6),
            "is_estimated": has_estimate,
            "breakdowns": [_usage_breakdown_log_metadata(item) for item in breakdowns],
        },
    )


def log_route_turn_usage(
    *,
    route: str,
    tag: str,
    prompt: str,
    since: int = 0,
) -> None:
    """Log per-turn LLM tokens and cost for a single route."""
    accumulator = get_current_usage_accumulator()
    base_extra = {"tag": tag, "route": route}
    if accumulator is None:
        logger.warning(
            "Route turn missing usage accumulator",
            extra={**base_extra, "usage_status": "no_accumulator"},
        )
        return

    snapshot = accumulator.snapshot(since=since)
    summary = get_route_usage_summary(route, since=since)
    if summary is None:
        logger.warning(
            "Route turn recorded no matching usage",
            extra={
                **base_extra,
                "usage_status": "no_route_usage",
                "breakdown_count": len(snapshot.breakdowns),
                "breakdowns": [
                    _usage_breakdown_log_metadata(item) for item in snapshot.breakdowns
                ],
            },
        )
        return

    cost_usd = summary.cost_micros / 1_000_000
    provider_cost_str = _format_provider_costs(summary.breakdowns)
    logger.info(
        "Route turn usage recorded: $%.6f [%s] (model=%s in=%d out=%d cached=%d)",
        cost_usd,
        provider_cost_str,
        summary.model,
        summary.prompt_tokens,
        summary.completion_tokens,
        summary.cached_tokens,
        extra={
            **base_extra,
            "usage_status": "recorded",
            "model": summary.model,
            "input_tokens": summary.prompt_tokens,
            "output_tokens": summary.completion_tokens,
            "cached_tokens": summary.cached_tokens,
            "total_tokens": summary.total_tokens,
            "cost_usd": round(cost_usd, 6),
            "is_estimated": summary.is_estimated,
            "breakdowns": [
                _usage_breakdown_log_metadata(item) for item in summary.breakdowns
            ],
        },
    )


def _truncate_prompt(prompt: str, *, max_len: int = 120) -> str:
    cleaned = " ".join(prompt.split())
    if len(cleaned) <= max_len:
        return cleaned
    return f"{cleaned[: max_len - 3]}..."


def _format_provider_costs(breakdowns: list[LLMUsageBreakdown]) -> str:
    """Render per-provider cost as e.g. ``openrouter=$0.001411, serper=$0.002000``."""
    totals: dict[str, int] = {}
    for item in breakdowns:
        totals[item.provider] = totals.get(item.provider, 0) + item.cost_micros
    return ", ".join(
        f"{provider}=${micros / 1_000_000:.6f}"
        for provider, micros in sorted(totals.items())
    )


def _usage_breakdown_log_metadata(item: LLMUsageBreakdown) -> dict[str, Any]:
    return {
        "route": item.route,
        "source": item.source,
        "model": item.model,
        "input_tokens": item.prompt_tokens,
        "output_tokens": item.completion_tokens,
        "cached_tokens": item.cached_tokens,
        "total_tokens": item.total_tokens,
        "cost_usd": round(item.cost_micros / 1_000_000, 6),
        "is_estimated": item.is_estimated,
    }


def record_embedding_estimate(
    *,
    model: str | None,
    char_count: int,
    route: str,
    source: str,
) -> LLMUsageBreakdown:
    normalized_model = normalize_embedding_model(model)
    estimated_tokens = estimate_embedding_tokens(char_count)
    breakdown = LLMUsageBreakdown(
        model=normalized_model,
        prompt_tokens=estimated_tokens,
        completion_tokens=0,
        total_tokens=estimated_tokens,
        cached_tokens=0,
        cost_micros=compute_embedding_cost_micros(normalized_model, estimated_tokens),
        is_estimated=True,
        route=route,
        source=source,
        provider=EMBEDDING_PROVIDER,
    )
    return record_usage_breakdown(breakdown)


def persist_embedding_estimate_direct(
    *,
    api_key_hash: str,
    model: str | None,
    char_count: int,
    route: str,
    source: str,
    request_id: str,
) -> LLMUsageBreakdown | None:
    """Persist an embedding estimate when no reservation accumulator is active."""
    breakdown = record_embedding_estimate(
        model=model,
        char_count=char_count,
        route=route,
        source=source,
    )
    if get_current_usage_accumulator() is not None:
        return breakdown

    from api.rate_limiting.rate_limiter import record_direct_usage

    record_direct_usage(
        api_key_hash=api_key_hash,
        tokens_used=breakdown.total_tokens,
        model=breakdown.model,
        request_id=request_id,
        cost_micros=breakdown.cost_micros,
        prompt_tokens=breakdown.prompt_tokens,
        completion_tokens=breakdown.completion_tokens,
        total_tokens=breakdown.total_tokens,
        cached_tokens=breakdown.cached_tokens,
        provider=breakdown.provider,
        route=breakdown.route,
        source=breakdown.source,
        is_estimated=breakdown.is_estimated,
        stream_terminated_early=False,
    )
    return breakdown
