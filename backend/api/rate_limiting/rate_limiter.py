"""Serverless LLM budgeting with cost-based rate limiting."""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import time
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass, fields
from typing import Any, AsyncIterator, cast

from fastapi import HTTPException
from starlette.concurrency import run_in_threadpool

from api.rate_limiting.llm_pricing import (
    default_reservation_for_route,
    normalize_generation_model,
    DEFAULT_GENERATION_MODEL,
    DEFAULT_LLM_PROVIDER,
)
from api.rate_limiting.llm_usage import (
    get_current_usage_accumulator,
    label_models,
    label_sources,
)
from api.rate_limiting.reservation_engine import (
    COST_ACCOUNTING_SCHEMA_VERSION,
    ROLLING_AVG_UPDATE_LUA,
    ROLLING_AVG_VERSION_KEY,
    get_reservation_micros,
    reservation_from_stats,
    rolling_stats_keys,
    rolling_update_keys,
)

logger = logging.getLogger(__name__)

_upstash_client = None

CONFIG_CACHE_TTL = 300
CONFIG_CACHE_VERSION = "2026-06-23-chat-usage-v1"
CONFIG_KEY_PREFIX = "ratelimit:config:"
# Versioned so old period-suffixed counters are not reused after chat_usage migration.
COST_USAGE_KEY_PREFIX = "ratelimit:cost_usage:v3:"
USER_BUDGET_CURRENCY = "USD"


def get_upstash_client():
    global _upstash_client
    if _upstash_client is None:
        url = os.getenv("UPSTASH_REDIS_REST_URL")
        token = os.getenv("UPSTASH_REDIS_REST_TOKEN")
        if not url or not token:
            logger.warning("Upstash Redis not configured. Rate limiting disabled.")
            return None
        from upstash_redis import Redis

        cold_start = time.monotonic()
        _upstash_client = Redis(url=url, token=token)
        elapsed_ms = (time.monotonic() - cold_start) * 1000
        logger.info("Upstash Redis client initialized in %.1fms", elapsed_ms)
    return _upstash_client


def set_upstash_client_for_testing(client) -> None:
    global _upstash_client
    _upstash_client = client


def hash_api_key(raw_key: str) -> str:
    return hashlib.sha256(raw_key.encode("utf-8")).hexdigest()


def _user_api_key_hash(user_id: str) -> str:
    """Derive a deterministic API key hash for per-user budget tracking."""
    return hashlib.sha256(f"user:{user_id}".encode("utf-8")).hexdigest()


def ensure_user_api_key(user_id: str) -> str:
    """Return the per-user api_key_hash, auto-creating chat usage if needed."""
    from api.database.core import SessionLocal
    from api.database.repository import RateLimitRepository

    api_key_hash = _user_api_key_hash(user_id)
    with SessionLocal() as db:
        global_settings = RateLimitRepository.get_admin_usage_settings(db)
        existing = RateLimitRepository.get_api_key_by_user_id(db, user_id)
        if existing is not None:
            existing_budget_micros = getattr(existing, "budget_micros", None)
            if (
                existing_budget_micros is None
                or existing.budget_currency != USER_BUDGET_CURRENCY
            ):
                existing = RateLimitRepository.update_api_key_budget_config(
                    db,
                    existing,
                    budget_micros=(
                        int(existing_budget_micros)
                        if existing_budget_micros is not None
                        else global_settings.budget_micros
                    ),
                    budget_currency=USER_BUDGET_CURRENCY,
                )
            return cast(str, existing.api_key_hash)

        RateLimitRepository.create_api_key(
            db,
            user_id=user_id,
            api_key_hash=api_key_hash,
            budget_micros=global_settings.budget_micros,
            usage_reset_interval_days=global_settings.usage_reset_interval_days,
            budget_currency=USER_BUDGET_CURRENCY,
            name="auto-provisioned",
        )
    return api_key_hash


@dataclass(frozen=True, init=False)
class ChatUsageConfig:
    chat_usage_id: str
    is_active: bool
    budget_micros: int
    budget_currency: str

    def __init__(
        self,
        *,
        chat_usage_id: str | None = None,
        api_key_id: str | None = None,
        is_active: bool,
        budget_micros: int,
        budget_currency: str,
        budget_period: str | None = None,
    ) -> None:
        object.__setattr__(self, "chat_usage_id", chat_usage_id or api_key_id or "")
        object.__setattr__(self, "is_active", is_active)
        object.__setattr__(self, "budget_micros", budget_micros)
        object.__setattr__(self, "budget_currency", budget_currency)

    @property
    def api_key_id(self) -> str:
        return self.chat_usage_id

    @property
    def budget_period(self) -> str:
        return "lifetime"


ApiKeyConfig = ChatUsageConfig


def _raise_missing_budget_config_error(chat_usage_id: str) -> None:
    logger.error(
        "Cost-based limiter requires budget_micros for every active chat_usage row. "
        "Missing budget_micros for chat_usage_id=%s",
        chat_usage_id,
    )
    raise HTTPException(
        status_code=503,
        detail="Rate limiter configuration is invalid. Contact support.",
    )


def _fetch_config_from_db(api_key_hash: str) -> ChatUsageConfig | None:
    from api.database.core import SessionLocal
    from api.database.repository import RateLimitRepository

    start = time.monotonic()
    with SessionLocal() as db:
        if hasattr(RateLimitRepository, "get_chat_usage_by_hash"):
            row = RateLimitRepository.get_chat_usage_by_hash(db, api_key_hash)
        else:
            row = RateLimitRepository.get_api_key_by_hash(db, api_key_hash)
    elapsed_ms = (time.monotonic() - start) * 1000
    logger.info(
        "ChatUsage Supabase fetch took %.1fms (hash=%s…)",
        elapsed_ms,
        api_key_hash[:8],
    )

    if row is None:
        return None
    raw_budget = row.budget_micros
    return ChatUsageConfig(
        chat_usage_id=cast(str, row.id),
        is_active=bool(row.is_active),
        budget_micros=int(raw_budget) if raw_budget is not None else None,  # type: ignore[arg-type]
        budget_currency=cast(str, getattr(row, "budget_currency", "USD")),
    )


def _config_from_cache(cached) -> ChatUsageConfig | None:
    """Parse a cached config entry; None on a miss. Raises on a stale entry."""
    if cached is None:
        return None
    data = json.loads(cached) if isinstance(cached, str) else cached
    if data.get("cache_version") != CONFIG_CACHE_VERSION:
        raise ValueError("stale rate-limit config cache entry")
    if "chat_usage_id" not in data and "api_key_id" in data:
        data["chat_usage_id"] = data["api_key_id"]
    # Filter unknown keys so stale config cache entries remain harmless.
    valid_fields = {f.name for f in fields(ChatUsageConfig)}
    data = {k: v for k, v in data.items() if k in valid_fields}
    return ChatUsageConfig(**data)


@dataclass
class _ReservationReads:
    config: ChatUsageConfig | None
    rolling_count: Any
    rolling_avg: Any
    cost_counter: Any


def _read_reservation_state(
    client, api_key_hash: str, route: str
) -> _ReservationReads | None:
    """Everything a reservation reads from Redis, in one pipelined request:
    cached config, rolling-average version/count/avg and the cost counter.
    Returns None if the pipeline fails (callers fall back to single reads)."""
    count_key, avg_key = rolling_stats_keys(route)
    pipe = client.pipeline()
    pipe.get(f"{CONFIG_KEY_PREFIX}{api_key_hash}")
    pipe.get(ROLLING_AVG_VERSION_KEY)
    pipe.get(count_key)
    pipe.get(avg_key)
    pipe.get(cost_usage_key(api_key_hash))
    try:
        cached, version, count_raw, avg_raw, cost_raw = pipe.exec()
    except Exception as exc:
        logger.warning("Pipelined reservation read failed: %s", exc)
        return None

    try:
        config = _config_from_cache(cached)
    except Exception as exc:
        logger.warning("Config cache read failed: %s", exc)
        config = None
    if config is None:
        config = fetch_api_key_config(api_key_hash)  # miss: DB + cache fill

    if version != COST_ACCOUNTING_SCHEMA_VERSION:
        try:
            client.set(ROLLING_AVG_VERSION_KEY, COST_ACCOUNTING_SCHEMA_VERSION)
        except Exception as exc:
            logger.warning("Rolling average version set failed: %s", exc)
    return _ReservationReads(config, count_raw, avg_raw, cost_raw)


def fetch_api_key_config(api_key_hash: str) -> ChatUsageConfig | None:
    client = get_upstash_client()
    if client is None:
        return _fetch_config_from_db(api_key_hash)

    cache_key = f"{CONFIG_KEY_PREFIX}{api_key_hash}"
    try:
        cached_config = _config_from_cache(client.get(cache_key))
        if cached_config is not None:
            return cached_config
    except Exception as exc:
        logger.warning("Config cache read failed: %s", exc)

    config = _fetch_config_from_db(api_key_hash)
    if config is None:
        return None

    try:
        client.set(
            cache_key,
            json.dumps(
                {
                    "chat_usage_id": config.chat_usage_id,
                    "is_active": config.is_active,
                    "budget_micros": config.budget_micros,
                    "budget_currency": config.budget_currency,
                    "cache_version": CONFIG_CACHE_VERSION,
                }
            ),
            ex=CONFIG_CACHE_TTL,
        )
    except Exception as exc:
        logger.warning("Config cache write failed: %s", exc)

    return config


# Lifetime budget: the counter is persistent (no TTL). A missing key (cold start
# or eviction) is seeded from the DB's effective usage (ARGV[3]) so eviction and
# the historical :rolling_week -> :lifetime key rename never grant a free reset.
STRICT_COST_RESERVATION_LUA = """
if redis.call('EXISTS', KEYS[1]) == 0 then
    redis.call('SET', KEYS[1], ARGV[3])
end
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local reservation = tonumber(ARGV[1])
local budget = tonumber(ARGV[2])

if current + reservation > budget then
    return -1
end

redis.call('INCRBY', KEYS[1], reservation)

return budget - (current + reservation)
"""


def _db_effective_used_micros(chat_usage_id: str) -> int:
    """Authoritative effective usage from the DB, used to seed a cold Redis
    counter. Reads fresh (not the config cache) since this is the rare path."""
    if not chat_usage_id:
        return 0
    from api.database.core import SessionLocal
    from api.database.repository import RateLimitRepository

    with SessionLocal() as db:
        return RateLimitRepository.get_effective_cost_used_micros(
            db, api_key_id=chat_usage_id
        )


def cost_usage_key(api_key_hash: str, period: str | None = None) -> str:
    return f"{COST_USAGE_KEY_PREFIX}{api_key_hash}"


def _resolve_actual_cost_micros(
    *,
    ctx: "ReservationContext",
    usage_summary,
    request_id: str,
    route: str,
    request_failed: bool = False,
) -> int:
    actual_cost_micros = ctx.actual_cost_micros
    if actual_cost_micros is not None:
        return actual_cost_micros

    if usage_summary and usage_summary.cost_micros > 0:
        return usage_summary.cost_micros

    # The request failed before producing any usage (e.g. the LLM call raised or
    # timed out). Release the reservation entirely instead of charging the
    # fallback estimate for work the user never received.
    if request_failed:
        logger.info(
            "Request failed with no usage for req=%s route=%s; "
            "releasing reserved=%d micros.",
            request_id,
            route,
            ctx.reserved_cost_micros,
        )
        return 0

    logger.warning(
        "No actual cost data for req=%s route=%s; using reserved=%d micros. "
        "Redis counter may drift.",
        request_id,
        route,
        ctx.reserved_cost_micros,
    )
    return ctx.reserved_cost_micros


def _source_for_usage_log(usage_summary) -> str | None:
    if not usage_summary or not usage_summary.breakdowns:
        return None
    return label_sources(item.source for item in usage_summary.breakdowns)


def _provider_row(breakdowns, *, provider: str, fallback_model: str) -> dict:
    model = label_models(item.model for item in breakdowns)
    if model == "unknown":
        model = fallback_model
    total_tokens = sum(item.total_tokens for item in breakdowns)
    return {
        "tokens_used": total_tokens,
        "model": model,
        "cost_micros": sum(item.cost_micros for item in breakdowns),
        "prompt_tokens": sum(item.prompt_tokens for item in breakdowns),
        "completion_tokens": sum(item.completion_tokens for item in breakdowns),
        "total_tokens": total_tokens,
        "cached_tokens": sum(item.cached_tokens for item in breakdowns),
        "provider": provider,
        "source": label_sources(item.source for item in breakdowns),
        "is_estimated": any(item.is_estimated for item in breakdowns),
    }


def _usage_log_rows(
    *,
    usage_summary,
    actual_cost_micros: int,
    normalized_model: str,
    cost_is_overridden: bool,
) -> list[dict]:
    """Build per-row kwargs for usage logging, one row per provider.

    External-provider cost (e.g. Serper) is logged as its own ``provider`` row so
    it stays attributable in the ledger and reconcilable against vendor
    dashboards. The split only activates when the cost is accumulator-derived
    (so the per-provider rows sum back to the billed total); every other case —
    no breakdowns, an overridden cost, an estimate — keeps a single primary-provider
    row.
    """
    model_for_log = normalized_model
    if usage_summary and usage_summary.model not in {"unknown", "multiple"}:
        model_for_log = usage_summary.model
    elif usage_summary and usage_summary.model == "multiple":
        model_for_log = "multiple"

    breakdowns = list(usage_summary.breakdowns) if usage_summary else []
    other = [b for b in breakdowns if b.provider != DEFAULT_LLM_PROVIDER]
    can_split = (
        not cost_is_overridden
        and bool(breakdowns)
        and bool(other)
        and usage_summary.cost_micros == actual_cost_micros
    )

    if not can_split:
        actual_tokens = (
            usage_summary.total_tokens
            if usage_summary and usage_summary.total_tokens > 0
            else 0
        )
        is_estimated = bool(usage_summary.is_estimated) if usage_summary else True
        if not usage_summary or not usage_summary.breakdowns:
            is_estimated = True
        return [
            {
                "tokens_used": actual_tokens,
                "model": model_for_log,
                "cost_micros": actual_cost_micros,
                "prompt_tokens": usage_summary.prompt_tokens if usage_summary else 0,
                "completion_tokens": (
                    usage_summary.completion_tokens if usage_summary else 0
                ),
                "total_tokens": actual_tokens,
                "cached_tokens": usage_summary.cached_tokens if usage_summary else 0,
                "provider": DEFAULT_LLM_PROVIDER,
                "source": _source_for_usage_log(usage_summary),
                "is_estimated": is_estimated,
            }
        ]

    rows: list[dict] = []
    primary = [b for b in breakdowns if b.provider == DEFAULT_LLM_PROVIDER]
    if primary:
        rows.append(
            _provider_row(
                primary,
                provider=DEFAULT_LLM_PROVIDER,
                fallback_model=model_for_log,
            )
        )

    grouped: dict[str, list] = {}
    for item in other:
        grouped.setdefault(item.provider, []).append(item)
    for provider, items in grouped.items():
        rows.append(_provider_row(items, provider=provider, fallback_model=provider))
    return rows


def _emit_usage_logs(
    *,
    chat_usage_id: str,
    usage_summary,
    actual_cost_micros: int,
    normalized_model: str,
    cost_is_overridden: bool,
    request_id: str,
    route: str,
    stream_terminated_early: bool,
) -> None:
    """Persist one usage log per provider for a completed reservation."""
    for row in _usage_log_rows(
        usage_summary=usage_summary,
        actual_cost_micros=actual_cost_micros,
        normalized_model=normalized_model,
        cost_is_overridden=cost_is_overridden,
    ):
        _log_usage_background(
            chat_usage_id=chat_usage_id,
            request_id=request_id,
            route=route,
            stream_terminated_early=stream_terminated_early,
            **row,
        )


@dataclass
class ReservationContext:
    chat_usage_id: str
    api_key_hash: str
    reserved_cost_micros: int
    actual_cost_micros: int | None
    model: str
    request_id: str
    route: str
    stream_terminated_early: bool = False

    @property
    def api_key_id(self) -> str:
        return self.chat_usage_id


def _get_estimated_cost_micros(
    *,
    route: str,
    fallback_cost_micros: int | None,
    client,
) -> int:
    fallback = fallback_cost_micros or default_reservation_for_route(route)
    return get_reservation_micros(route, fallback, client=client)


@asynccontextmanager
async def reserve_llm_budget(
    api_key_hash: str,
    *,
    estimated_cost_micros: int | None = None,
    route: str = "rag",
    fallback_cost_micros: int | None = None,
    model: str = DEFAULT_GENERATION_MODEL,
    request_id: str | None = None,
) -> AsyncIterator[ReservationContext]:
    if request_id is None:
        request_id = str(uuid.uuid4())

    normalized_route = route.lower()
    normalized_model = normalize_generation_model(model)
    client = await run_in_threadpool(get_upstash_client)
    reads = (
        await run_in_threadpool(
            _read_reservation_state, client, api_key_hash, normalized_route
        )
        if client is not None
        else None
    )
    if reads is not None:
        config = reads.config
    else:
        config = await run_in_threadpool(fetch_api_key_config, api_key_hash)

    if config is not None and not config.is_active:
        raise HTTPException(status_code=403, detail="API key is deactivated")

    if client is None:
        ctx = ReservationContext(
            chat_usage_id=config.chat_usage_id if config else "",
            api_key_hash=api_key_hash,
            reserved_cost_micros=estimated_cost_micros or fallback_cost_micros or 0,
            actual_cost_micros=None,
            model=normalized_model,
            request_id=request_id,
            route=normalized_route,
        )
        _baseline_acc = get_current_usage_accumulator()
        _baseline_count = (
            _baseline_acc.breakdown_count() if _baseline_acc is not None else 0
        )

        request_failed = False
        try:
            yield ctx
        except BaseException:
            request_failed = True
            raise
        finally:
            usage_summary = None
            if _baseline_acc is not None:
                usage_summary = _baseline_acc.snapshot(since=_baseline_count)

            actual_cost_micros = _resolve_actual_cost_micros(
                ctx=ctx,
                usage_summary=usage_summary,
                request_id=request_id,
                route=normalized_route,
                request_failed=request_failed,
            )

            if ctx.chat_usage_id:
                _emit_usage_logs(
                    chat_usage_id=ctx.chat_usage_id,
                    usage_summary=usage_summary,
                    actual_cost_micros=actual_cost_micros,
                    normalized_model=normalized_model,
                    cost_is_overridden=ctx.actual_cost_micros is not None,
                    request_id=request_id,
                    route=normalized_route,
                    stream_terminated_early=ctx.stream_terminated_early,
                )
        return

    if config is None:
        logger.warning(
            "No chat_usage row found for hash=%s…. Rate limiting disabled.",
            api_key_hash[:8],
        )
        ctx = ReservationContext(
            chat_usage_id="",
            api_key_hash=api_key_hash,
            reserved_cost_micros=estimated_cost_micros or fallback_cost_micros or 0,
            actual_cost_micros=None,
            model=normalized_model,
            request_id=request_id,
            route=normalized_route,
        )
        yield ctx
        return

    if estimated_cost_micros is not None:
        reserved_cost_micros = estimated_cost_micros
    elif reads is not None:
        reserved_cost_micros = reservation_from_stats(
            reads.rolling_count,
            reads.rolling_avg,
            fallback_cost_micros or default_reservation_for_route(normalized_route),
        )
    else:
        reserved_cost_micros = await run_in_threadpool(
            _get_estimated_cost_micros,
            route=normalized_route,
            fallback_cost_micros=fallback_cost_micros,
            client=client,
        )
    cost_key = cost_usage_key(api_key_hash)

    if config.budget_micros is None:
        _raise_missing_budget_config_error(config.chat_usage_id)
    seed_micros = 0
    try:
        counter_missing = (
            reads.cost_counter is None
            if reads is not None
            else await run_in_threadpool(client.get, cost_key) is None
        )
        if counter_missing:
            seed_micros = await run_in_threadpool(
                _db_effective_used_micros,
                config.chat_usage_id,
            )
    except Exception as exc:
        logger.warning("Cold-key seed lookup failed for %s…: %s", cost_key[:24], exc)
    try:
        remaining = await run_in_threadpool(
            client.eval,
            STRICT_COST_RESERVATION_LUA,
            keys=[cost_key],
            args=[
                str(reserved_cost_micros),
                str(config.budget_micros),
                str(seed_micros),
            ],
        )
        if remaining is not None and int(remaining) == -1:
            raise HTTPException(
                status_code=429,
                detail="The shared AI service limit has been reached.",
            )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Cost reservation failed: %s", exc)
        raise HTTPException(status_code=503, detail="Rate limiting service unavailable")

    ctx = ReservationContext(
        chat_usage_id=config.chat_usage_id,
        api_key_hash=api_key_hash,
        reserved_cost_micros=reserved_cost_micros,
        actual_cost_micros=None,
        model=normalized_model,
        request_id=request_id,
        route=normalized_route,
    )

    # Capture baseline so reconciliation only attributes usage from this reservation,
    # not earlier reservations sharing the same accumulator scope.
    _baseline_acc = get_current_usage_accumulator()
    _baseline_count = (
        _baseline_acc.breakdown_count() if _baseline_acc is not None else 0
    )

    request_failed = False
    try:
        yield ctx
    except BaseException:
        request_failed = True
        raise
    finally:
        usage_summary = None
        if _baseline_acc is not None:
            usage_summary = _baseline_acc.snapshot(since=_baseline_count)

        actual_cost_micros = _resolve_actual_cost_micros(
            ctx=ctx,
            usage_summary=usage_summary,
            request_id=request_id,
            route=normalized_route,
            request_failed=request_failed,
        )

        cost_adjustment = actual_cost_micros - ctx.reserved_cost_micros
        update_average = bool(
            usage_summary
            and usage_summary.breakdowns
            and not usage_summary.is_estimated
            and not ctx.stream_terminated_early
            and actual_cost_micros > 0
        )
        # Counter reconciliation and the rolling-average update share one
        # pipelined request instead of up to five sequential round trips.
        if cost_adjustment != 0 or update_average:
            pipe = client.pipeline()
            if cost_adjustment != 0:
                pipe.incrby(cost_key, cost_adjustment)
            if update_average:
                pipe.eval(
                    ROLLING_AVG_UPDATE_LUA,
                    keys=rolling_update_keys(normalized_route),
                    args=[str(actual_cost_micros)],
                )
            try:
                await run_in_threadpool(pipe.exec)
            except Exception as exc:
                logger.error(
                    "Cost reconciliation failed for key=%s… req=%s "
                    "(reserved=%d actual=%d delta=%d): %s. "
                    "Redis counter may drift; DB usage log remains authoritative.",
                    api_key_hash[:8],
                    request_id,
                    ctx.reserved_cost_micros,
                    actual_cost_micros,
                    cost_adjustment,
                    exc,
                )

        if config.chat_usage_id:
            _emit_usage_logs(
                chat_usage_id=config.chat_usage_id,
                usage_summary=usage_summary,
                actual_cost_micros=actual_cost_micros,
                normalized_model=normalized_model,
                cost_is_overridden=ctx.actual_cost_micros is not None,
                request_id=request_id,
                route=normalized_route,
                stream_terminated_early=ctx.stream_terminated_early,
            )


def _log_usage_background(
    chat_usage_id: str,
    tokens_used: int,
    model: str,
    request_id: str,
    *,
    cost_micros: int,
    prompt_tokens: int,
    completion_tokens: int,
    total_tokens: int,
    cached_tokens: int,
    provider: str,
    route: str,
    source: str | None,
    is_estimated: bool,
    stream_terminated_early: bool,
) -> None:
    def _persist_usage_log():
        from api.database.core import SessionLocal
        from api.database.repository import RateLimitRepository

        with SessionLocal() as db:
            RateLimitRepository.log_token_usage(
                db,
                chat_usage_id,
                tokens_used,
                model,
                request_id,
                cost_micros=cost_micros,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                total_tokens=total_tokens,
                cached_tokens=cached_tokens,
                provider=provider,
                route=route,
                source=source,
                is_estimated=is_estimated,
                stream_terminated_early=stream_terminated_early,
            )
        logger.info(
            "Persisted usage to chat_usage_logs: $%.6f (%s) "
            "provider=%s route=%s source=%s in=%d out=%d cached=%d req=%s",
            cost_micros / 1_000_000,
            "estimated" if is_estimated else "actual",
            provider,
            route,
            source,
            prompt_tokens,
            completion_tokens,
            cached_tokens,
            request_id,
        )

    async def _log():
        try:
            await run_in_threadpool(_persist_usage_log)
        except Exception as exc:
            logger.error("Background usage logging failed: %s", exc)

    try:
        asyncio.get_running_loop().create_task(_log())
    except RuntimeError:
        logger.warning("No event loop for background usage logging")


def record_direct_usage(
    *,
    api_key_hash: str,
    tokens_used: int,
    model: str,
    request_id: str,
    cost_micros: int,
    prompt_tokens: int,
    completion_tokens: int,
    total_tokens: int,
    cached_tokens: int,
    provider: str,
    route: str,
    source: str | None,
    is_estimated: bool,
    stream_terminated_early: bool,
) -> None:
    """Persist provider usage that occurs outside a reservation scope."""
    config = fetch_api_key_config(api_key_hash)
    if config is None:
        logger.warning(
            "No chat_usage row found for direct usage hash=%s…. Usage not persisted.",
            api_key_hash[:8],
        )
        return
    if not config.is_active:
        raise HTTPException(status_code=403, detail="API key is deactivated")
    if config.budget_micros is None:
        _raise_missing_budget_config_error(config.chat_usage_id)

    client = get_upstash_client()
    if client is not None:
        try:
            usage_key = cost_usage_key(api_key_hash)
            # Seed a cold/evicted persistent counter from the DB before adding, so
            # the lifetime total never silently drops to this single charge.
            if client.get(usage_key) is None:
                client.set(usage_key, _db_effective_used_micros(config.chat_usage_id))
            client.incrby(usage_key, cost_micros)
        except Exception as exc:
            logger.error("Direct usage Redis increment failed: %s", exc)

    _log_usage_background(
        chat_usage_id=config.chat_usage_id,
        tokens_used=tokens_used,
        model=model,
        request_id=request_id,
        cost_micros=cost_micros,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=total_tokens,
        cached_tokens=cached_tokens,
        provider=provider,
        route=route,
        source=source,
        is_estimated=is_estimated,
        stream_terminated_early=stream_terminated_early,
    )
