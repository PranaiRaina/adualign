import os
import logging
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

os.environ.setdefault("SUPABASE_DATABASE_URL", "sqlite:///./test-usage-router.db")

from api.routers import usage as usage_router


@pytest.fixture(autouse=True)
def _stub_address_credit_balance(monkeypatch):
    monkeypatch.setattr(
        usage_router.ServiceCreditRepository,
        "get_balance",
        lambda db, user_id, service_type: None,
    )


class _RedisWithDelete:
    def __init__(self):
        self.values = {usage_router.cost_usage_key("hash-123", "lifetime"): "7000"}
        self.deleted: list[str] = []

    def delete(self, key: str):
        self.deleted.append(key)
        self.values.pop(key, None)

    def get(self, key: str):
        return self.values.get(key)


def _budget_status_api_key():
    return SimpleNamespace(
        id="ak-123",
        budget_period="lifetime",
        budget_micros=20_000,
        budget_currency="USD",
    )


@pytest.mark.anyio
async def test_get_my_usage_returns_current_chat_usage(monkeypatch):
    api_key_row = SimpleNamespace(
        id="ak-123",
        api_key_hash="hash-123",
        budget_period="lifetime",
        budget_micros=2_000_000,
        budget_currency="USD",
    )

    monkeypatch.setattr(usage_router, "ensure_user_api_key", lambda uid: "hash-123")
    monkeypatch.setattr(
        usage_router.RateLimitRepository,
        "get_api_key_by_user_id",
        lambda db, user_id: api_key_row,
    )
    monkeypatch.setattr(
        usage_router.RateLimitRepository,
        "get_period_usage_totals_for_user",
        lambda db, user_id, period, reset_at=None: {
            "cost_used_micros": 1234,
            "total_tokens_used": 300,
            "prompt_tokens_used": 200,
            "completion_tokens_used": 100,
            "map_search_count": 0,
        },
    )
    monkeypatch.setattr(usage_router, "get_upstash_client", lambda: None)

    response = usage_router.get_my_usage(
        current_user=SimpleNamespace(id="user-123"),
        db=object(),
    )

    assert response.cost_used_micros == 1234
    assert response.cost_remaining_micros == 1_998_766
    assert response.percent_used == 0.0617
    assert response.percent_remaining == 99.9383
    # Lifetime budget never auto-resets: resets_at is intentionally empty.
    assert response.resets_at == ""


@pytest.mark.anyio
async def test_get_my_usage_uses_lifetime_default_when_key_is_missing(monkeypatch):
    monkeypatch.setattr(usage_router, "ensure_user_api_key", lambda uid: "hash-123")
    monkeypatch.setattr(
        usage_router.RateLimitRepository,
        "get_api_key_by_user_id",
        lambda db, user_id: None,
    )

    response = usage_router.get_my_usage(
        current_user=SimpleNamespace(id="user-123"),
        db=object(),
    )

    assert response.resets_at == ""
    assert response.percent_used == 0.0


@pytest.mark.anyio
async def test_get_my_usage_falls_back_to_db_cost_when_redis_is_cold(monkeypatch):
    api_key_row = SimpleNamespace(
        id="ak-123",
        api_key_hash="hash-123",
        budget_period="lifetime",
        budget_micros=2_000_000,
        budget_currency="USD",
    )

    class _ColdRedis:
        def get(self, key: str):
            return None

    monkeypatch.setattr(usage_router, "ensure_user_api_key", lambda uid: "hash-123")
    monkeypatch.setattr(
        usage_router.RateLimitRepository,
        "get_api_key_by_user_id",
        lambda db, user_id: api_key_row,
    )
    monkeypatch.setattr(
        usage_router.RateLimitRepository,
        "get_period_usage_totals_for_user",
        lambda db, user_id, period, reset_at=None: {
            "cost_used_micros": 4321,
            "total_tokens_used": 300,
            "prompt_tokens_used": 200,
            "completion_tokens_used": 100,
            "map_search_count": 0,
        },
    )
    monkeypatch.setattr(usage_router, "get_upstash_client", lambda: _ColdRedis())

    response = usage_router.get_my_usage(
        current_user=SimpleNamespace(id="user-123"),
        db=object(),
    )

    assert response.cost_used_micros == 4321


@pytest.mark.anyio
async def test_get_my_usage_returns_meter_fields_needed_by_ui(monkeypatch, caplog):
    api_key_row = SimpleNamespace(
        id="ak-123",
        api_key_hash="hash-123",
        budget_period="lifetime",
        budget_micros=100_000,
        budget_currency="USD",
    )

    monkeypatch.setattr(usage_router, "ensure_user_api_key", lambda uid: "hash-123")
    monkeypatch.setattr(
        usage_router.RateLimitRepository,
        "get_api_key_by_user_id",
        lambda db, user_id: api_key_row,
    )
    monkeypatch.setattr(
        usage_router.RateLimitRepository,
        "get_period_usage_totals_for_user",
        lambda db, user_id, period, reset_at=None: {
            "cost_used_micros": 25_000,
            "total_tokens_used": 250,
            "prompt_tokens_used": 200,
            "completion_tokens_used": 50,
            "map_search_count": 2,
        },
    )
    monkeypatch.setattr(usage_router, "get_upstash_client", lambda: None)

    with caplog.at_level(logging.INFO):
        response = usage_router.get_my_usage(
            current_user=SimpleNamespace(id="user-123"),
            db=object(),
        )

    assert response.cost_remaining_micros == 75_000
    assert response.percent_used == 25.0
    assert response.percent_remaining == 75.0
    assert any(
        record.getMessage().startswith("Usage budget returned")
        and "$0.025000" in record.getMessage()  # cost_used_micros 25_000 -> USD
        and record.user_id == "user-123"
        and record.cost_used_micros == 25_000
        for record in caplog.records
    )


@pytest.mark.anyio
async def test_different_users_get_separate_usage(monkeypatch):
    """Two users should see different usage data (per-user budget isolation)."""
    user_a_key = SimpleNamespace(
        id="ak-a",
        api_key_hash="hash-a",
        budget_period="lifetime",
        budget_micros=2_000_000,
        budget_currency="USD",
    )
    user_b_key = SimpleNamespace(
        id="ak-b",
        api_key_hash="hash-b",
        budget_period="lifetime",
        budget_micros=2_000_000,
        budget_currency="USD",
    )

    def fake_ensure(uid):
        return "hash-a" if uid == "user-a" else "hash-b"

    def fake_get_by_user(db, user_id):
        return user_a_key if user_id == "user-a" else user_b_key

    def fake_totals(db, user_id, period, reset_at=None):
        cost = 100_000 if user_id == "user-a" else 0
        return {
            "cost_used_micros": cost,
            "total_tokens_used": 0,
            "prompt_tokens_used": 0,
            "completion_tokens_used": 0,
            "map_search_count": 0,
        }

    monkeypatch.setattr(usage_router, "ensure_user_api_key", fake_ensure)
    monkeypatch.setattr(
        usage_router.RateLimitRepository,
        "get_api_key_by_user_id",
        fake_get_by_user,
    )
    monkeypatch.setattr(
        usage_router.RateLimitRepository,
        "get_period_usage_totals_for_user",
        fake_totals,
    )
    monkeypatch.setattr(usage_router, "get_upstash_client", lambda: None)

    resp_a = usage_router.get_my_usage(
        current_user=SimpleNamespace(id="user-a"),
        db=object(),
    )
    resp_b = usage_router.get_my_usage(
        current_user=SimpleNamespace(id="user-b"),
        db=object(),
    )

    assert resp_a.cost_used_micros == 100_000
    assert resp_b.cost_used_micros == 0


@pytest.mark.anyio
async def test_get_my_usage_aggregates_costs_across_user_keys(monkeypatch):
    api_key_row = SimpleNamespace(
        id="ak-current",
        api_key_hash="hash-123",
        budget_period="lifetime",
        budget_micros=2_000_000,
        budget_currency="USD",
    )

    monkeypatch.setattr(usage_router, "ensure_user_api_key", lambda uid: "hash-123")
    monkeypatch.setattr(
        usage_router.RateLimitRepository,
        "get_api_key_by_user_id",
        lambda db, user_id: api_key_row,
    )
    monkeypatch.setattr(
        usage_router.RateLimitRepository,
        "get_period_usage_totals_for_user",
        lambda db, user_id, period, reset_at=None: {
            "cost_used_micros": 50_000,
            "total_tokens_used": 900,
            "prompt_tokens_used": 600,
            "completion_tokens_used": 300,
            "map_search_count": 4,
        },
    )
    monkeypatch.setattr(usage_router, "get_upstash_client", lambda: None)

    response = usage_router.get_my_usage(
        current_user=SimpleNamespace(id="user-123"),
        db=object(),
    )

    assert response.cost_used_micros == 50_000
    assert response.total_tokens_used == 900
    assert response.map_search_count == 4


@pytest.mark.anyio
async def test_get_my_usage_fails_closed_for_null_budget(monkeypatch):
    api_key_row = SimpleNamespace(
        id="ak-123",
        api_key_hash="hash-123",
        budget_period="lifetime",
        budget_micros=None,
        budget_currency="USD",
    )

    monkeypatch.setattr(usage_router, "ensure_user_api_key", lambda uid: "hash-123")
    monkeypatch.setattr(
        usage_router.RateLimitRepository,
        "get_api_key_by_user_id",
        lambda db, user_id: api_key_row,
    )
    monkeypatch.setattr(
        usage_router.RateLimitRepository,
        "get_period_usage_totals_for_user",
        lambda db, user_id, period, reset_at=None: {
            "cost_used_micros": 0,
            "total_tokens_used": 0,
            "prompt_tokens_used": 0,
            "completion_tokens_used": 0,
            "map_search_count": 0,
        },
    )
    monkeypatch.setattr(usage_router, "get_upstash_client", lambda: None)

    with pytest.raises(HTTPException) as exc_info:
        usage_router.get_my_usage(
            current_user=SimpleNamespace(id="user-123"),
            db=object(),
        )

    assert exc_info.value.status_code == 503


@pytest.mark.anyio
async def test_get_budget_status_requires_admin(monkeypatch):
    monkeypatch.setattr(usage_router, "is_admin", lambda db, user_id: False)

    with pytest.raises(HTTPException) as exc_info:
        usage_router.get_budget_status(
            current_user=SimpleNamespace(id="user-123", role="member"),
            db=object(),
        )

    assert exc_info.value.status_code == 403


@pytest.mark.anyio
async def test_get_budget_status_prefers_higher_redis_usage(monkeypatch):
    api_key_row = _budget_status_api_key()

    class _WarmRedis:
        def get(self, key: str):
            return "9000"

    monkeypatch.setattr(usage_router, "is_admin", lambda db, user_id: True)
    monkeypatch.setattr(usage_router, "ensure_user_api_key", lambda uid: "hash-123")
    monkeypatch.setattr(
        usage_router.RateLimitRepository,
        "get_api_key_by_user_id",
        lambda db, user_id: api_key_row,
    )
    monkeypatch.setattr(
        usage_router.RateLimitRepository,
        "get_period_usage_totals_for_user",
        lambda db, user_id, period, reset_at=None: {"cost_used_micros": 5_000},
    )
    monkeypatch.setattr(usage_router, "get_upstash_client", lambda: _WarmRedis())

    response = usage_router.get_budget_status(
        reset=False,
        user_id=None,
        current_user=SimpleNamespace(id="admin-123", role="admin"),
        db=object(),
    )

    assert response.db_cost_used_micros == 5_000
    assert response.redis_cost_used_micros == 9_000
    assert response.effective_cost_used_micros == 9_000
    assert response.remaining_budget_micros == 11_000
    assert response.percent_used == 45.0
    assert response.redis_available is True


@pytest.mark.anyio
async def test_get_budget_status_reset_clears_redis_counter(monkeypatch):
    api_key_row = _budget_status_api_key()
    redis_client = _RedisWithDelete()
    redis_key = usage_router.cost_usage_key("hash-123", "lifetime")

    monkeypatch.setattr(usage_router, "is_admin", lambda db, user_id: True)
    monkeypatch.setattr(usage_router, "ensure_user_api_key", lambda uid: "hash-123")
    monkeypatch.setattr(
        usage_router.RateLimitRepository,
        "get_api_key_by_user_id",
        lambda db, user_id: api_key_row,
    )
    monkeypatch.setattr(
        usage_router.RateLimitRepository,
        "get_period_usage_totals_for_user",
        lambda db, user_id, period, reset_at=None: {"cost_used_micros": 5_000},
    )
    monkeypatch.setattr(usage_router, "get_upstash_client", lambda: redis_client)

    response = usage_router.get_budget_status(
        reset=True,
        user_id=None,
        current_user=SimpleNamespace(id="admin-123", role="admin"),
        db=object(),
    )

    assert redis_client.deleted == [redis_key]
    assert response.redis_counter_cleared is True
    assert response.reset_applied is True
    assert response.redis_cost_used_micros == 0
    assert response.effective_cost_used_micros == 5_000


@pytest.mark.anyio
async def test_get_budget_status_clear_redis_counter_alias(monkeypatch):
    api_key_row = _budget_status_api_key()
    redis_client = _RedisWithDelete()
    redis_key = usage_router.cost_usage_key("hash-123", "lifetime")

    monkeypatch.setattr(usage_router, "is_admin", lambda db, user_id: True)
    monkeypatch.setattr(usage_router, "ensure_user_api_key", lambda uid: "hash-123")
    monkeypatch.setattr(
        usage_router.RateLimitRepository,
        "get_api_key_by_user_id",
        lambda db, user_id: api_key_row,
    )
    monkeypatch.setattr(
        usage_router.RateLimitRepository,
        "get_period_usage_totals_for_user",
        lambda db, user_id, period, reset_at=None: {"cost_used_micros": 5_000},
    )
    monkeypatch.setattr(usage_router, "get_upstash_client", lambda: redis_client)

    response = usage_router.get_budget_status(
        reset=False,
        clear_redis_counter=True,
        user_id=None,
        current_user=SimpleNamespace(id="admin-123", role="admin"),
        db=object(),
    )

    assert redis_client.deleted == [redis_key]
    assert response.redis_counter_cleared is True
    assert response.reset_applied is True
    assert response.redis_cost_used_micros == 0
    assert response.effective_cost_used_micros == 5_000


@pytest.mark.anyio
async def test_get_budget_status_without_clear_leaves_redis_counter(monkeypatch):
    api_key_row = _budget_status_api_key()
    redis_client = _RedisWithDelete()

    monkeypatch.setattr(usage_router, "is_admin", lambda db, user_id: True)
    monkeypatch.setattr(usage_router, "ensure_user_api_key", lambda uid: "hash-123")
    monkeypatch.setattr(
        usage_router.RateLimitRepository,
        "get_api_key_by_user_id",
        lambda db, user_id: api_key_row,
    )
    monkeypatch.setattr(
        usage_router.RateLimitRepository,
        "get_period_usage_totals_for_user",
        lambda db, user_id, period, reset_at=None: {"cost_used_micros": 5_000},
    )
    monkeypatch.setattr(usage_router, "get_upstash_client", lambda: redis_client)

    response = usage_router.get_budget_status(
        reset=False,
        clear_redis_counter=False,
        user_id=None,
        current_user=SimpleNamespace(id="admin-123", role="admin"),
        db=object(),
    )

    assert redis_client.deleted == []
    assert response.redis_counter_cleared is False
    assert response.reset_applied is False
    assert response.redis_cost_used_micros == 7_000
    assert response.effective_cost_used_micros == 7_000


def test_get_api_key_by_user_id_prefers_newest_active_row():
    from api.database.repository import RateLimitRepository

    class _Query:
        def __init__(self):
            self.calls = []

        def filter(self, *args):
            self.calls.append(("filter", args))
            return self

        def order_by(self, *args):
            self.calls.append(("order_by", args))
            return self

        def first(self):
            self.calls.append(("first", ()))
            return "latest-row"

    class _DB:
        def __init__(self):
            self.query_obj = _Query()

        def query(self, model):
            return self.query_obj

    db = _DB()
    result = RateLimitRepository.get_api_key_by_user_id(db, "user-123")

    assert result == "latest-row"
    assert any(call[0] == "order_by" for call in db.query_obj.calls)


def test_create_api_key_reuses_existing_active_row_after_user_lock():
    from api.database.repository import RateLimitRepository

    existing_row = SimpleNamespace(id="ak-existing")

    class _UserLockQuery:
        def __init__(self):
            self.calls = []

        def filter(self, *args):
            self.calls.append(("filter", args))
            return self

        def with_for_update(self):
            self.calls.append(("with_for_update", ()))
            return self

        def one(self):
            self.calls.append(("one", ()))
            return SimpleNamespace(id="user-123")

    class _ApiKeyQuery:
        def __init__(self):
            self.calls = []

        def filter(self, *args):
            self.calls.append(("filter", args))
            return self

        def order_by(self, *args):
            self.calls.append(("order_by", args))
            return self

        def first(self):
            self.calls.append(("first", ()))
            return existing_row

    class _DB:
        def __init__(self):
            self.user_query = _UserLockQuery()
            self.key_query = _ApiKeyQuery()
            self.add_called = False
            self.commit_called = False

        def query(self, model):
            if getattr(model, "__name__", "") == "User":
                return self.user_query
            return self.key_query

        def add(self, value):
            self.add_called = True

        def commit(self):
            self.commit_called = True

        def refresh(self, value):
            raise AssertionError(
                "refresh should not run when an active key already exists"
            )

    db = _DB()
    result = RateLimitRepository.create_api_key(
        db,
        user_id="user-123",
        api_key_hash="hash-123",
        budget_micros=1000,
    )

    assert result is existing_row
    assert any(call[0] == "with_for_update" for call in db.user_query.calls)
    assert db.add_called is False
    assert db.commit_called is False


@pytest.mark.anyio
async def test_get_my_usage_uses_custom_budget_for_percentages(monkeypatch):
    api_key_row = SimpleNamespace(
        id="ak-123",
        api_key_hash="hash-123",
        budget_period="lifetime",
        budget_micros=5_000_000,
        budget_currency="USD",
    )

    monkeypatch.setattr(usage_router, "ensure_user_api_key", lambda uid: "hash-123")
    monkeypatch.setattr(
        usage_router.RateLimitRepository,
        "get_api_key_by_user_id",
        lambda db, user_id: api_key_row,
    )
    monkeypatch.setattr(
        usage_router.RateLimitRepository,
        "get_period_usage_totals_for_user",
        lambda db, user_id, period, reset_at=None: {
            "cost_used_micros": 1_000_000,
            "total_tokens_used": 0,
            "prompt_tokens_used": 0,
            "completion_tokens_used": 0,
            "map_search_count": 0,
        },
    )
    monkeypatch.setattr(usage_router, "get_upstash_client", lambda: None)

    response = usage_router.get_my_usage(
        current_user=SimpleNamespace(id="user-123"),
        db=object(),
    )

    assert response.cost_used_micros == 1_000_000
    assert response.cost_remaining_micros == 4_000_000
    assert response.percent_used == 20.0
