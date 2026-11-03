"""Redis-backed rolling reservation estimates for cost-based limiting."""

from __future__ import annotations

import logging
import math

from api.rate_limiting.llm_pricing import (
    ROLLING_AVG_BUFFER_MULTIPLIER,
    ROLLING_AVG_MIN_SAMPLES,
    ROLLING_AVG_VERSION,
)

logger = logging.getLogger(__name__)

COST_ACCOUNTING_SCHEMA_VERSION = ROLLING_AVG_VERSION
ROLLING_AVG_VERSION_KEY = "rolling_avg:version"


def _rolling_avg_key(route: str) -> str:
    return f"rolling_avg:{COST_ACCOUNTING_SCHEMA_VERSION}:{route}"


def _rolling_avg_sum_key(route: str) -> str:
    return f"rolling_avg:{COST_ACCOUNTING_SCHEMA_VERSION}:{route}:sum"


def _rolling_avg_count_key(route: str) -> str:
    return f"rolling_avg:{COST_ACCOUNTING_SCHEMA_VERSION}:{route}:count"


def _ensure_version(client, route: str) -> bool:
    try:
        stored_version = client.get(ROLLING_AVG_VERSION_KEY)
        if stored_version == COST_ACCOUNTING_SCHEMA_VERSION:
            return True

        client.set(ROLLING_AVG_VERSION_KEY, COST_ACCOUNTING_SCHEMA_VERSION)
        return True
    except Exception as exc:
        logger.warning(
            "Rolling average version check failed for route=%s: %s", route, exc
        )
        return False


def get_reservation_micros(route: str, fallback_micros: int, client=None) -> int:
    normalized_route = route.lower()
    if client is None:
        from api.rate_limiting.rate_limiter import get_upstash_client

        client = get_upstash_client()
    if client is None:
        return fallback_micros

    if not _ensure_version(client, normalized_route):
        return fallback_micros

    try:
        count_raw = client.get(_rolling_avg_count_key(normalized_route))
        avg_raw = client.get(_rolling_avg_key(normalized_route))
    except Exception as exc:
        logger.warning(
            "Rolling average lookup failed for route=%s: %s", normalized_route, exc
        )
        return fallback_micros

    return reservation_from_stats(count_raw, avg_raw, fallback_micros)


def reservation_from_stats(count_raw, avg_raw, fallback_micros: int) -> int:
    """Reservation size from raw rolling-average counters (pure)."""
    count = int(count_raw or 0)
    avg = int(avg_raw or 0)
    if count < ROLLING_AVG_MIN_SAMPLES or avg <= 0:
        return fallback_micros
    return int(math.ceil(avg * ROLLING_AVG_BUFFER_MULTIPLIER))


def rolling_stats_keys(route: str) -> tuple[str, str]:
    """(count, average) keys read when sizing a reservation."""
    normalized_route = route.lower()
    return _rolling_avg_count_key(normalized_route), _rolling_avg_key(normalized_route)


# Atomic sum/count/average update: one round trip instead of GET (version) +
# INCRBY + INCRBY + SET. KEYS = sum, count, avg; ARGV[1] = actual cost.
ROLLING_AVG_UPDATE_LUA = """
local s = redis.call('INCRBY', KEYS[1], ARGV[1])
local c = redis.call('INCRBY', KEYS[2], 1)
local avg = math.ceil(s / math.max(c, 1))
redis.call('SET', KEYS[3], avg)
return avg
"""


def rolling_update_keys(route: str) -> list[str]:
    normalized_route = route.lower()
    return [
        _rolling_avg_sum_key(normalized_route),
        _rolling_avg_count_key(normalized_route),
        _rolling_avg_key(normalized_route),
    ]


def update_rolling_average(route: str, actual_cost_micros: int, client=None) -> None:
    normalized_route = route.lower()
    if actual_cost_micros <= 0:
        return
    if client is None:
        from api.rate_limiting.rate_limiter import get_upstash_client

        client = get_upstash_client()
    if client is None:
        return

    if not _ensure_version(client, normalized_route):
        return

    try:
        new_sum = client.incrby(
            _rolling_avg_sum_key(normalized_route), actual_cost_micros
        )
        new_count = client.incrby(_rolling_avg_count_key(normalized_route), 1)
        rolling_average = int(math.ceil(int(new_sum) / max(int(new_count), 1)))
        client.set(_rolling_avg_key(normalized_route), rolling_average)
    except Exception as exc:
        logger.warning(
            "Rolling average update failed for route=%s: %s", normalized_route, exc
        )
