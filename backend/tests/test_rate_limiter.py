"""Tests for the cost-based rate limiter (api/rate_limiter.py)."""

import hashlib
import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from api.rate_limiting.rate_limiter import (
    ApiKeyConfig,
    ReservationContext,
    _fetch_config_from_db,
    hash_api_key,
    ensure_user_api_key,
    reserve_llm_budget,
    set_upstash_client_for_testing,
    fetch_api_key_config,
    CONFIG_KEY_PREFIX,
    CONFIG_CACHE_VERSION,
    cost_usage_key,
)


# ── Fake Upstash client ─────────────────────────────────────────────


class FakeUpstashClient:
    """Test double for upstash_redis.Redis."""

    def __init__(self, *, data=None, eval_return=None, incrby_error=None):
        self.data: dict[str, str] = data or {}
        self.eval_return = eval_return
        self.incrby_error = incrby_error
        self.eval_calls: list[dict] = []
        self.incrby_calls: list[dict] = []
        self.set_calls: list[dict] = []
        self.get_calls: list[str] = []

    def get(self, key: str):
        self.get_calls.append(key)
        return self.data.get(key)

    def set(self, key: str, value, ex=None):
        self.set_calls.append({"key": key, "value": value, "ex": ex})
        self.data[key] = value

    def eval(self, script, keys=None, args=None):
        self.eval_calls.append({"script": script, "keys": keys, "args": args})
        if self.eval_return is not None:
            return self.eval_return
        return 5000  # default: plenty of budget remaining

    def incrby(self, key: str, amount: int):
        self.incrby_calls.append({"key": key, "amount": amount})
        if self.incrby_error:
            raise self.incrby_error

    def pipeline(self):
        return FakePipeline(self)

    @property
    def round_trips(self) -> int:
        """HTTP requests a real Upstash client would make: one per direct
        command, one per pipeline exec (commands replayed inside it excluded)."""
        direct = (
            len(self.get_calls)
            + len(self.set_calls)
            + len(self.eval_calls)
            + len(self.incrby_calls)
        )
        return direct - self.pipelined_commands + self.pipeline_execs

    pipeline_execs = 0
    pipelined_commands = 0


class FakePipeline:
    """Queues commands, then replays them on the fake client in ``exec``."""

    def __init__(self, client: FakeUpstashClient) -> None:
        self._client = client
        self._ops: list[tuple[str, tuple, dict]] = []

    def __getattr__(self, name: str):
        def queue(*args, **kwargs):
            self._ops.append((name, args, kwargs))
            return self

        return queue

    def exec(self):
        self._client.pipeline_execs += 1
        self._client.pipelined_commands += len(self._ops)
        ops, self._ops = self._ops, []
        return [getattr(self._client, name)(*a, **k) for name, a, k in ops]


# ── Helpers ──────────────────────────────────────────────────────────

FAKE_HASH = hashlib.sha256(b"test-key-123").hexdigest()

FAKE_CONFIG = ApiKeyConfig(
    chat_usage_id="ak-001",
    is_active=True,
    budget_micros=1_000_000,
    budget_currency="USD",
)

INACTIVE_CONFIG = ApiKeyConfig(
    chat_usage_id="ak-002",
    is_active=False,
    budget_micros=1_000_000,
    budget_currency="USD",
)


def _cache_config(client: FakeUpstashClient, api_key_hash: str, config: ApiKeyConfig):
    """Pre-populate the Upstash config cache for a given key."""
    cache_key = f"{CONFIG_KEY_PREFIX}{api_key_hash}"
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
    )


# ── Tests ────────────────────────────────────────────────────────────


def test_hash_api_key_deterministic():
    key = "my-secret-api-key"
    expected = hashlib.sha256(key.encode("utf-8")).hexdigest()
    assert hash_api_key(key) == expected
    assert hash_api_key(key) == hash_api_key(key)


def test_lifetime_cost_key_is_stable_key():
    assert cost_usage_key(FAKE_HASH) == f"ratelimit:cost_usage:v3:{FAKE_HASH}"


@pytest.mark.anyio
async def test_reservation_under_budget_succeeds():
    client = FakeUpstashClient(eval_return=994_000)  # 1_000_000 - 6_000 = 994_000
    set_upstash_client_for_testing(client)
    _cache_config(client, FAKE_HASH, FAKE_CONFIG)

    try:
        async with reserve_llm_budget(
            api_key_hash=FAKE_HASH,
            fallback_cost_micros=6_000,
            model="deepseek-v4-flash",
            request_id="req-001",
        ) as ctx:
            assert isinstance(ctx, ReservationContext)
            assert ctx.reserved_cost_micros == 6_000
            assert ctx.chat_usage_id == "ak-001"

        # Verify Lua eval was called with cost args
        assert len(client.eval_calls) == 1
        call = client.eval_calls[0]
        assert call["args"][0] == "6000"  # reservation in micros
        assert call["args"][1] == "1000000"  # budget_micros
    finally:
        set_upstash_client_for_testing(None)


@pytest.mark.anyio
async def test_reservation_over_budget_returns_429():
    client = FakeUpstashClient(eval_return=-1)  # over budget
    set_upstash_client_for_testing(client)
    _cache_config(client, FAKE_HASH, FAKE_CONFIG)

    try:
        with pytest.raises(HTTPException) as exc_info:
            async with reserve_llm_budget(
                api_key_hash=FAKE_HASH,
                fallback_cost_micros=6_000,
                model="deepseek-v4-flash",
            ):
                pass
        assert exc_info.value.status_code == 429
        assert "shared ai service limit" in exc_info.value.detail.lower()
    finally:
        set_upstash_client_for_testing(None)


@pytest.mark.anyio
async def test_cold_key_is_seeded_from_db_effective_usage(monkeypatch):
    """A cold/evicted Redis counter is seeded from the DB effective usage so a
    lifetime budget survives eviction without granting a free reset."""
    client = FakeUpstashClient(eval_return=900_000)
    set_upstash_client_for_testing(client)
    _cache_config(client, FAKE_HASH, FAKE_CONFIG)  # config cached; no cost counter

    seed_calls: list[str] = []

    def fake_seed(chat_usage_id):
        seed_calls.append(chat_usage_id)
        return 250_000

    monkeypatch.setattr(
        "api.rate_limiting.rate_limiter._db_effective_used_micros", fake_seed
    )

    try:
        async with reserve_llm_budget(
            api_key_hash=FAKE_HASH,
            fallback_cost_micros=6_000,
            model="deepseek-v4-flash",
            request_id="req-seed",
        ):
            pass

        assert seed_calls == ["ak-001"]
        # Seed value is handed to the Lua as the 3rd arg.
        assert client.eval_calls[0]["args"][2] == "250000"
    finally:
        set_upstash_client_for_testing(None)


@pytest.mark.anyio
async def test_warm_key_is_not_seeded(monkeypatch):
    """A present counter skips the DB seed lookup and passes seed 0."""
    client = FakeUpstashClient(eval_return=900_000)
    set_upstash_client_for_testing(client)
    _cache_config(client, FAKE_HASH, FAKE_CONFIG)
    client.data[cost_usage_key(FAKE_HASH, "lifetime")] = "100000"  # warm counter

    def fail_seed(chat_usage_id):
        raise AssertionError("DB seed must not run for a warm key")

    monkeypatch.setattr(
        "api.rate_limiting.rate_limiter._db_effective_used_micros", fail_seed
    )

    try:
        async with reserve_llm_budget(
            api_key_hash=FAKE_HASH,
            fallback_cost_micros=6_000,
            model="deepseek-v4-flash",
        ):
            pass

        assert client.eval_calls[0]["args"][2] == "0"
    finally:
        set_upstash_client_for_testing(None)


@pytest.mark.anyio
async def test_cost_reconciliation_adjusts_counter():
    client = FakeUpstashClient(eval_return=994_000)
    set_upstash_client_for_testing(client)
    _cache_config(client, FAKE_HASH, FAKE_CONFIG)

    try:
        async with reserve_llm_budget(
            api_key_hash=FAKE_HASH,
            fallback_cost_micros=6_000,
            model="deepseek-v4-flash",
            request_id="req-reconcile",
        ) as ctx:
            ctx.actual_cost_micros = 3_000  # used less than reserved

        # Verify INCRBY was called with negative adjustment
        assert len(client.incrby_calls) == 1
        assert client.incrby_calls[0]["amount"] == -3_000  # 3000 - 6000
    finally:
        set_upstash_client_for_testing(None)


@pytest.mark.anyio
async def test_reconciliation_no_adjustment_when_exact():
    client = FakeUpstashClient(eval_return=994_000)
    set_upstash_client_for_testing(client)
    _cache_config(client, FAKE_HASH, FAKE_CONFIG)

    try:
        async with reserve_llm_budget(
            api_key_hash=FAKE_HASH,
            fallback_cost_micros=6_000,
            model="deepseek-v4-flash",
        ) as ctx:
            ctx.actual_cost_micros = 6_000  # exact match

        # No INCRBY needed
        assert len(client.incrby_calls) == 0
    finally:
        set_upstash_client_for_testing(None)


@pytest.mark.anyio
async def test_reconciliation_failure_logs_usage_exactly_once(monkeypatch):
    """When INCRBY fails, usage should still be logged exactly once (no double-counting)."""
    client = FakeUpstashClient(
        eval_return=994_000,
        incrby_error=ConnectionError("Upstash unavailable"),
    )
    set_upstash_client_for_testing(client)
    _cache_config(client, FAKE_HASH, FAKE_CONFIG)

    logged_usage = []
    monkeypatch.setattr(
        "api.rate_limiting.rate_limiter._log_usage_background",
        lambda *args, **kwargs: logged_usage.append(kwargs),
    )

    try:
        async with reserve_llm_budget(
            api_key_hash=FAKE_HASH,
            fallback_cost_micros=6_000,
            model="deepseek-v4-flash",
            request_id="req-fail",
        ) as ctx:
            ctx.actual_cost_micros = 1_000  # triggers adjustment

        # Exactly one usage log entry, not two
        assert len(logged_usage) == 1
        assert logged_usage[0]["cost_micros"] == 1_000
        assert logged_usage[0]["request_id"] == "req-fail"
    finally:
        set_upstash_client_for_testing(None)


@pytest.mark.anyio
async def test_reconciliation_failure_with_no_usage_summary(monkeypatch):
    """When INCRBY fails and no usage accumulator exists, usage is still logged once
    using the reserved cost as fallback."""
    client = FakeUpstashClient(
        eval_return=994_000,
        incrby_error=ConnectionError("Upstash unavailable"),
    )
    set_upstash_client_for_testing(client)
    _cache_config(client, FAKE_HASH, FAKE_CONFIG)

    logged_usage = []
    monkeypatch.setattr(
        "api.rate_limiting.rate_limiter._log_usage_background",
        lambda *args, **kwargs: logged_usage.append(kwargs),
    )
    # Force no usage accumulator so usage_summary is None
    monkeypatch.setattr(
        "api.rate_limiting.rate_limiter.get_current_usage_accumulator",
        lambda: None,
    )

    try:
        async with reserve_llm_budget(
            api_key_hash=FAKE_HASH,
            fallback_cost_micros=6_000,
            model="deepseek-v4-flash",
            request_id="req-no-acc",
        ):
            pass  # no actual_cost_micros set, no accumulator

        # Still exactly one log entry, falling back to reserved cost
        assert len(logged_usage) == 1
        assert logged_usage[0]["cost_micros"] == 6_000
        assert logged_usage[0]["is_estimated"] is True
    finally:
        set_upstash_client_for_testing(None)


@pytest.mark.anyio
async def test_no_double_counting_when_cost_differs(monkeypatch):
    """When actual cost differs from reserved, only one usage log is created."""
    client = FakeUpstashClient(eval_return=994_000)
    set_upstash_client_for_testing(client)
    _cache_config(client, FAKE_HASH, FAKE_CONFIG)

    logged_usage = []
    monkeypatch.setattr(
        "api.rate_limiting.rate_limiter._log_usage_background",
        lambda *args, **kwargs: logged_usage.append(kwargs),
    )

    try:
        async with reserve_llm_budget(
            api_key_hash=FAKE_HASH,
            fallback_cost_micros=6_000,
            model="deepseek-v4-flash",
            request_id="req-no-dupe",
        ) as ctx:
            ctx.actual_cost_micros = 2_000  # differs from reserved 6_000

        # Exactly one usage log, recording the actual cost
        assert len(logged_usage) == 1
        assert logged_usage[0]["cost_micros"] == 2_000

        # Redis counter was adjusted
        assert len(client.incrby_calls) == 1
        assert client.incrby_calls[0]["amount"] == -4_000  # 2000 - 6000
    finally:
        set_upstash_client_for_testing(None)


@pytest.mark.anyio
async def test_failed_request_with_no_usage_is_refunded(monkeypatch):
    """When the body raises before producing any usage, the full reservation is
    released (counter decremented back) and the logged cost is 0."""
    client = FakeUpstashClient(eval_return=994_000)
    set_upstash_client_for_testing(client)
    _cache_config(client, FAKE_HASH, FAKE_CONFIG)

    logged_usage = []
    monkeypatch.setattr(
        "api.rate_limiting.rate_limiter._log_usage_background",
        lambda *args, **kwargs: logged_usage.append(kwargs),
    )

    try:
        with pytest.raises(RuntimeError, match="LLM exploded"):
            async with reserve_llm_budget(
                api_key_hash=FAKE_HASH,
                fallback_cost_micros=6_000,
                model="deepseek-v4-flash",
                request_id="req-failed",
            ):
                raise RuntimeError("LLM exploded")  # no usage recorded

        # Full reservation released: 0 - 6000 = -6000
        assert len(client.incrby_calls) == 1
        assert client.incrby_calls[0]["amount"] == -6_000

        # Usage logged once, at zero cost
        assert len(logged_usage) == 1
        assert logged_usage[0]["cost_micros"] == 0
    finally:
        set_upstash_client_for_testing(None)


@pytest.mark.anyio
async def test_successful_request_with_no_usage_still_charges_reserved(monkeypatch):
    """Regression guard: a request that completes normally without reporting usage
    keeps the reserved estimate (no refund), so estimation-only calls still bill."""
    client = FakeUpstashClient(eval_return=994_000)
    set_upstash_client_for_testing(client)
    _cache_config(client, FAKE_HASH, FAKE_CONFIG)

    logged_usage = []
    monkeypatch.setattr(
        "api.rate_limiting.rate_limiter._log_usage_background",
        lambda *args, **kwargs: logged_usage.append(kwargs),
    )
    monkeypatch.setattr(
        "api.rate_limiting.rate_limiter.get_current_usage_accumulator",
        lambda: None,
    )

    try:
        async with reserve_llm_budget(
            api_key_hash=FAKE_HASH,
            fallback_cost_micros=6_000,
            model="deepseek-v4-flash",
            request_id="req-ok-no-usage",
        ):
            pass  # success, but no usage data available

        # actual == reserved, so no adjustment and no refund
        assert len(client.incrby_calls) == 0
        assert len(logged_usage) == 1
        assert logged_usage[0]["cost_micros"] == 6_000
    finally:
        set_upstash_client_for_testing(None)


@pytest.mark.anyio
async def test_failed_request_with_partial_usage_charges_actual(monkeypatch):
    """When a request fails after partial usage was attributed, the explicit actual
    cost is honored rather than refunded to zero."""
    client = FakeUpstashClient(eval_return=994_000)
    set_upstash_client_for_testing(client)
    _cache_config(client, FAKE_HASH, FAKE_CONFIG)

    logged_usage = []
    monkeypatch.setattr(
        "api.rate_limiting.rate_limiter._log_usage_background",
        lambda *args, **kwargs: logged_usage.append(kwargs),
    )

    try:
        with pytest.raises(RuntimeError, match="failed mid-stream"):
            async with reserve_llm_budget(
                api_key_hash=FAKE_HASH,
                fallback_cost_micros=6_000,
                model="deepseek-v4-flash",
                request_id="req-partial",
            ) as ctx:
                ctx.actual_cost_micros = 1_500  # partial usage attributed
                raise RuntimeError("failed mid-stream")

        # Charged the partial actual, not refunded: 1500 - 6000 = -4500
        assert len(client.incrby_calls) == 1
        assert client.incrby_calls[0]["amount"] == -4_500
        assert len(logged_usage) == 1
        assert logged_usage[0]["cost_micros"] == 1_500
    finally:
        set_upstash_client_for_testing(None)


@pytest.mark.anyio
async def test_config_cache_hit_skips_supabase(monkeypatch):
    client = FakeUpstashClient()
    set_upstash_client_for_testing(client)
    _cache_config(client, FAKE_HASH, FAKE_CONFIG)
    client.data[cost_usage_key(FAKE_HASH)] = "0"

    db_calls = []

    def fake_fetch_from_db(api_key_hash):
        db_calls.append(api_key_hash)
        return FAKE_CONFIG

    monkeypatch.setattr(
        "api.rate_limiting.rate_limiter._fetch_config_from_db",
        fake_fetch_from_db,
    )

    try:
        config = fetch_api_key_config(FAKE_HASH)
        assert config is not None
        assert config.chat_usage_id == "ak-001"
        assert len(db_calls) == 0  # DB was NOT queried
    finally:
        set_upstash_client_for_testing(None)


@pytest.mark.anyio
async def test_config_cache_miss_fetches_and_caches(monkeypatch):
    client = FakeUpstashClient()  # empty data = cache miss
    set_upstash_client_for_testing(client)

    monkeypatch.setattr(
        "api.rate_limiting.rate_limiter._fetch_config_from_db",
        lambda h: FAKE_CONFIG,
    )

    try:
        config = fetch_api_key_config(FAKE_HASH)
        assert config is not None
        assert config.budget_micros == 1_000_000

        # Verify it was written to cache
        cache_key = f"{CONFIG_KEY_PREFIX}{FAKE_HASH}"
        assert any(c["key"] == cache_key for c in client.set_calls)
    finally:
        set_upstash_client_for_testing(None)


@pytest.mark.anyio
async def test_stale_cache_with_removed_field(monkeypatch):
    """Cached configs with removed fields should still deserialize."""
    client = FakeUpstashClient()
    set_upstash_client_for_testing(client)

    cache_key = f"{CONFIG_KEY_PREFIX}{FAKE_HASH}"
    client.set(
        cache_key,
        json.dumps(
            {
                "chat_usage_id": "ak-001",
                "removed_field": 10000,
                "budget_period": "lifetime",
                "is_active": True,
                "budget_micros": 1_000_000,
                "budget_currency": "USD",
                "cache_version": CONFIG_CACHE_VERSION,
            }
        ),
    )

    try:
        config = fetch_api_key_config(FAKE_HASH)
        assert config is not None
        assert config.chat_usage_id == "ak-001"
        assert config.budget_micros == 1_000_000
        assert not hasattr(config, "removed_field")
    finally:
        set_upstash_client_for_testing(None)


def test_stale_config_cache_without_current_version_is_ignored(monkeypatch):
    client = FakeUpstashClient()
    set_upstash_client_for_testing(client)
    cache_key = f"{CONFIG_KEY_PREFIX}{FAKE_HASH}"
    client.set(
        cache_key,
        json.dumps(
            {
                "chat_usage_id": "stale",
                "budget_period": "lifetime",
                "is_active": True,
                "budget_micros": 2_000_000,
                "budget_currency": "USD",
            }
        ),
    )
    monkeypatch.setattr(
        "api.rate_limiting.rate_limiter._fetch_config_from_db",
        lambda h: FAKE_CONFIG,
    )

    try:
        config = fetch_api_key_config(FAKE_HASH)
    finally:
        set_upstash_client_for_testing(None)

    assert config is not None
    assert config.chat_usage_id == "ak-001"


def test_ensure_user_api_key_reuses_existing_chat_usage(monkeypatch):
    existing_key = SimpleNamespace(
        api_key_hash="hash-legacy",
        budget_micros=2_000_000,
        budget_currency="USD",
    )
    updates: list[dict[str, object]] = []

    class _Session:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr("api.database.core.SessionLocal", lambda: _Session())
    monkeypatch.setattr(
        "api.database.repository.RateLimitRepository.get_api_key_by_user_id",
        lambda db, user_id: existing_key,
    )
    monkeypatch.setattr(
        "api.database.repository.RateLimitRepository.get_admin_usage_settings",
        lambda db: SimpleNamespace(
            budget_micros=750_000,
            usage_reset_interval_days=14,
        ),
    )

    def fake_update(
        db,
        api_key,
        *,
        budget_micros,
        budget_period=None,
        budget_currency="USD",
    ):
        updates.append(
            {
                "budget_micros": budget_micros,
                "budget_currency": budget_currency,
            }
        )
        api_key.budget_micros = budget_micros
        api_key.budget_currency = budget_currency
        return api_key

    monkeypatch.setattr(
        "api.database.repository.RateLimitRepository.update_api_key_budget_config",
        fake_update,
    )

    assert ensure_user_api_key("user-123") == "hash-legacy"
    assert existing_key.budget_micros == 2_000_000
    assert updates == []


def test_ensure_user_api_key_creates_chat_usage(
    monkeypatch,
):
    created: dict[str, object] = {}

    class _Session:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr("api.database.core.SessionLocal", lambda: _Session())
    monkeypatch.setattr(
        "api.database.repository.RateLimitRepository.get_api_key_by_user_id",
        lambda db, user_id: None,
    )
    monkeypatch.setattr(
        "api.database.repository.RateLimitRepository.get_admin_usage_settings",
        lambda db: SimpleNamespace(
            budget_micros=750_000,
            usage_reset_interval_days=14,
        ),
    )

    def fake_create(db, user_id, api_key_hash, **kwargs):
        created.update(kwargs)
        return SimpleNamespace(api_key_hash=api_key_hash)

    monkeypatch.setattr(
        "api.database.repository.RateLimitRepository.create_api_key",
        fake_create,
    )

    ensure_user_api_key("user-123")

    assert created["budget_micros"] == 750_000
    assert created["usage_reset_interval_days"] == 14


@pytest.mark.anyio
async def test_inactive_key_returns_403():
    client = FakeUpstashClient()
    set_upstash_client_for_testing(client)
    _cache_config(client, FAKE_HASH, INACTIVE_CONFIG)

    try:
        with pytest.raises(HTTPException) as exc_info:
            async with reserve_llm_budget(
                api_key_hash=FAKE_HASH,
                model="deepseek-v4-flash",
            ):
                pass
        assert exc_info.value.status_code == 403
        assert "deactivated" in exc_info.value.detail.lower()
    finally:
        set_upstash_client_for_testing(None)


@pytest.mark.anyio
async def test_no_api_key_row_passes_through(monkeypatch):
    """When no api_keys row exists, fail-open so the app keeps working.
    Rate limiting only activates once a row is explicitly created."""
    client = FakeUpstashClient()  # empty cache
    set_upstash_client_for_testing(client)

    monkeypatch.setattr(
        "api.rate_limiting.rate_limiter._fetch_config_from_db",
        lambda h: None,  # not found in DB
    )

    try:
        async with reserve_llm_budget(
            api_key_hash=FAKE_HASH,
            model="deepseek-v4-flash",
        ) as ctx:
            assert ctx.chat_usage_id == ""  # pass-through marker (same as unconfigured)
    finally:
        set_upstash_client_for_testing(None)


@pytest.mark.anyio
async def test_upstash_not_configured_passes_through(monkeypatch):
    set_upstash_client_for_testing(None)

    # Temporarily clear env vars to ensure client returns None
    import os

    old_url = os.environ.pop("UPSTASH_REDIS_REST_URL", None)
    old_token = os.environ.pop("UPSTASH_REDIS_REST_TOKEN", None)

    # Reset the global client so get_upstash_client() re-checks env
    import api.rate_limiting.rate_limiter as rl

    original_client = rl._upstash_client
    rl._upstash_client = None

    try:
        monkeypatch.setattr(rl, "_fetch_config_from_db", lambda h: FAKE_CONFIG)
        async with reserve_llm_budget(
            api_key_hash=FAKE_HASH,
            model="deepseek-v4-flash",
        ) as ctx:
            assert ctx.chat_usage_id == "ak-001"
    finally:
        rl._upstash_client = original_client
        if old_url:
            os.environ["UPSTASH_REDIS_REST_URL"] = old_url
        if old_token:
            os.environ["UPSTASH_REDIS_REST_TOKEN"] = old_token


@pytest.mark.anyio
async def test_upstash_not_configured_still_logs_usage(monkeypatch):
    import os
    import api.rate_limiting.rate_limiter as rl

    set_upstash_client_for_testing(None)
    original_client = rl._upstash_client
    rl._upstash_client = None
    old_url = os.environ.pop("UPSTASH_REDIS_REST_URL", None)
    old_token = os.environ.pop("UPSTASH_REDIS_REST_TOKEN", None)

    logged_usage = []
    monkeypatch.setattr(rl, "_fetch_config_from_db", lambda h: FAKE_CONFIG)
    monkeypatch.setattr(
        rl,
        "_log_usage_background",
        lambda *args, **kwargs: logged_usage.append(kwargs),
    )

    try:
        async with reserve_llm_budget(
            api_key_hash=FAKE_HASH,
            estimated_cost_micros=12_000,
            model="deepseek-v4-flash",
            request_id="req-db-fallback",
        ) as ctx:
            ctx.actual_cost_micros = 5678

        assert logged_usage == [
            {
                "chat_usage_id": "ak-001",
                "tokens_used": 0,
                "model": "deepseek-v4-flash",
                "request_id": "req-db-fallback",
                "cost_micros": 5678,
                "prompt_tokens": 0,
                "completion_tokens": 0,
                "total_tokens": 0,
                "cached_tokens": 0,
                "provider": "openrouter",
                "route": "rag",
                "source": None,
                "is_estimated": True,
                "stream_terminated_early": False,
            }
        ]
    finally:
        rl._upstash_client = original_client
        if old_url:
            os.environ["UPSTASH_REDIS_REST_URL"] = old_url
        if old_token:
            os.environ["UPSTASH_REDIS_REST_TOKEN"] = old_token


@pytest.mark.anyio
async def test_embedding_breakdown_is_included_in_final_usage_log(monkeypatch):
    import os
    import api.rate_limiting.rate_limiter as rl
    from api.rate_limiting.llm_usage import (
        record_embedding_estimate,
        usage_accumulator_scope,
    )

    set_upstash_client_for_testing(None)
    original_client = rl._upstash_client
    rl._upstash_client = None
    old_url = os.environ.pop("UPSTASH_REDIS_REST_URL", None)
    old_token = os.environ.pop("UPSTASH_REDIS_REST_TOKEN", None)

    logged_usage = []
    monkeypatch.setattr(rl, "_fetch_config_from_db", lambda h: FAKE_CONFIG)
    monkeypatch.setattr(
        rl,
        "_log_usage_background",
        lambda *args, **kwargs: logged_usage.append(kwargs),
    )

    try:
        with usage_accumulator_scope():
            async with reserve_llm_budget(
                api_key_hash=FAKE_HASH,
                route="rag",
                model="deepseek-v4-flash",
                request_id="req-embedding-aggregate",
            ):
                record_embedding_estimate(
                    model="gemini-embedding-001",
                    char_count=99,
                    route="rag",
                    source="rag.retriever.embedding",
                )

        assert logged_usage == [
            {
                "chat_usage_id": "ak-001",
                "tokens_used": 33,
                "model": "gemini-embedding-001",
                "request_id": "req-embedding-aggregate",
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
    finally:
        rl._upstash_client = original_client
        if old_url:
            os.environ["UPSTASH_REDIS_REST_URL"] = old_url
        if old_token:
            os.environ["UPSTASH_REDIS_REST_TOKEN"] = old_token


@pytest.mark.anyio
async def test_missing_budget_micros_fails_closed():
    client = FakeUpstashClient(eval_return=8000)
    set_upstash_client_for_testing(client)
    missing_budget_config = ApiKeyConfig(
        chat_usage_id="ak-missing-budget",
        budget_period="lifetime",
        is_active=True,
        budget_micros=None,  # type: ignore[arg-type]
        budget_currency="USD",
    )
    _cache_config(client, FAKE_HASH, missing_budget_config)

    try:
        with pytest.raises(HTTPException) as exc_info:
            async with reserve_llm_budget(
                api_key_hash=FAKE_HASH,
                route="rag",
                model="deepseek-v4-flash",
            ):
                pass
        assert exc_info.value.status_code == 503
        assert "configuration" in exc_info.value.detail.lower()
    finally:
        set_upstash_client_for_testing(None)


# ── Legacy NULL budget_micros tests ─────────────────────────────────


def test_fetch_config_from_db_handles_null_budget_micros(monkeypatch):
    """_fetch_config_from_db must not crash when budget_micros is NULL in the DB row."""
    from types import SimpleNamespace

    fake_row = SimpleNamespace(
        id="ak-legacy",
        budget_period="lifetime",
        is_active=True,
        budget_micros=None,  # legacy NULL
        budget_currency="USD",
    )

    class FakeDB:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

    class FakeRepo:
        @staticmethod
        def get_api_key_by_hash(db, api_key_hash):
            return fake_row

    monkeypatch.setattr("api.database.core.SessionLocal", lambda: FakeDB())
    monkeypatch.setattr("api.database.repository.RateLimitRepository", FakeRepo)

    config = _fetch_config_from_db(FAKE_HASH)
    assert config is not None
    assert config.budget_micros is None
    assert config.chat_usage_id == "ak-legacy"
    assert config.is_active is True


def test_record_direct_usage_persists_and_counts_cost(monkeypatch):
    import api.rate_limiting.rate_limiter as rl

    client = FakeUpstashClient()
    set_upstash_client_for_testing(client)
    _cache_config(client, FAKE_HASH, FAKE_CONFIG)
    client.data[cost_usage_key(FAKE_HASH)] = "0"

    logged_usage = []
    monkeypatch.setattr(
        rl,
        "_log_usage_background",
        lambda *args, **kwargs: logged_usage.append(kwargs),
    )

    try:
        rl.record_direct_usage(
            api_key_hash=FAKE_HASH,
            tokens_used=34,
            model="gemini-embedding-001",
            request_id="req-embedding",
            cost_micros=6,
            prompt_tokens=34,
            completion_tokens=0,
            total_tokens=34,
            cached_tokens=0,
            provider="gemini",
            route="rag",
            source="rag.retriever.embedding",
            is_estimated=True,
            stream_terminated_early=False,
        )
    finally:
        set_upstash_client_for_testing(None)

    assert client.incrby_calls == [
        {
            "key": cost_usage_key(FAKE_HASH, "lifetime"),
            "amount": 6,
        }
    ]
    assert logged_usage == [
        {
            "chat_usage_id": "ak-001",
            "tokens_used": 34,
            "model": "gemini-embedding-001",
            "request_id": "req-embedding",
            "cost_micros": 6,
            "prompt_tokens": 34,
            "completion_tokens": 0,
            "total_tokens": 34,
            "cached_tokens": 0,
            "provider": "gemini",
            "route": "rag",
            "source": "rag.retriever.embedding",
            "is_estimated": True,
            "stream_terminated_early": False,
        }
    ]


@pytest.mark.anyio
async def test_null_budget_micros_from_db_fails_closed_at_runtime(monkeypatch):
    """A legacy row with NULL budget_micros fetched from DB must produce 503, not a crash."""
    client = FakeUpstashClient()  # empty cache -> triggers DB fetch
    set_upstash_client_for_testing(client)

    null_budget_config = ApiKeyConfig(
        chat_usage_id="ak-legacy",
        budget_period="lifetime",
        is_active=True,
        budget_micros=None,  # type: ignore[arg-type]
        budget_currency="USD",
    )

    monkeypatch.setattr(
        "api.rate_limiting.rate_limiter._fetch_config_from_db",
        lambda h: null_budget_config,
    )

    try:
        with pytest.raises(HTTPException) as exc_info:
            async with reserve_llm_budget(
                api_key_hash=FAKE_HASH,
                route="rag",
                model="deepseek-v4-flash",
            ):
                pass
        assert exc_info.value.status_code == 503
        assert "configuration" in exc_info.value.detail.lower()
    finally:
        set_upstash_client_for_testing(None)


@pytest.mark.anyio
async def test_reservation_batches_redis_round_trips(monkeypatch):
    """Warm reserve + settle with a rolling-average update takes 3 Redis round
    trips (pipelined reads, reservation EVAL, pipelined settle); it used to
    take 10 sequential calls."""
    import api.rate_limiting.rate_limiter as rl
    from langchain_core.messages import AIMessage

    from api.rate_limiting.llm_usage import (
        record_langchain_usage,
        usage_accumulator_scope,
    )
    from api.rate_limiting.reservation_engine import (
        COST_ACCOUNTING_SCHEMA_VERSION,
        ROLLING_AVG_UPDATE_LUA,
        ROLLING_AVG_VERSION_KEY,
    )

    client = FakeUpstashClient(eval_return=900_000)
    set_upstash_client_for_testing(client)
    _cache_config(client, FAKE_HASH, FAKE_CONFIG)
    client.data[cost_usage_key(FAKE_HASH)] = "100000"
    client.data[ROLLING_AVG_VERSION_KEY] = COST_ACCOUNTING_SCHEMA_VERSION
    monkeypatch.setattr(rl, "_log_usage_background", lambda *a, **k: None)
    setup_round_trips = client.round_trips

    try:
        with usage_accumulator_scope():
            async with reserve_llm_budget(
                api_key_hash=FAKE_HASH,
                route="rag",
                fallback_cost_micros=6_000,
                model="deepseek-v4-flash",
            ):
                record_langchain_usage(
                    raw_message=AIMessage(
                        content="answer",
                        usage_metadata={
                            "input_tokens": 1_000,
                            "output_tokens": 200,
                            "total_tokens": 1_200,
                        },
                        # OpenRouter-reported cost: actual (not estimated)
                        # usage, which is what feeds the rolling average.
                        response_metadata={"token_usage": {"cost": 0.004}},
                    ),
                    route="rag",
                    source="rag.generator",
                    model="deepseek-v4-flash",
                )

        assert client.round_trips - setup_round_trips == 3
        assert [c["script"] for c in client.eval_calls][-1] == ROLLING_AVG_UPDATE_LUA
    finally:
        set_upstash_client_for_testing(None)
