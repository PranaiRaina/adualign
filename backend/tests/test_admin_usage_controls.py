"""Admin lifetime-usage controls: reset usage and adjust lifetime budget by $5."""

from __future__ import annotations

import logging
import datetime
from collections.abc import Iterator
from types import SimpleNamespace
from typing import cast

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from api.database.models import (
    AdminUsageSettings,
    ApiKey,
    TokenUsageLog,
    User,
    UserServiceBalance,
    UserServiceTransaction,
)
from api.database.repository import RateLimitRepository
from api.routers import admin as admin_router
from api.routers import usage as usage_router
from api.rate_limiting.rate_limiter import (
    CONFIG_KEY_PREFIX,
    cost_usage_key,
)

USER_ID = "user-admin-controls"
API_KEY_ID = "api-key-admin-controls"
API_KEY_HASH = "hash-admin-controls"
BUDGET_MICROS = 10_000_000
ADMIN = SimpleNamespace(id="admin-1")
COST_KEY = cost_usage_key(API_KEY_HASH)
CONFIG_KEY = f"{CONFIG_KEY_PREFIX}{API_KEY_HASH}"


class FakeRedis:
    def __init__(self) -> None:
        self.data: dict[str, str] = {}
        self.deleted: list[str] = []

    def get(self, key: str):
        return self.data.get(key)

    def set(self, key: str, value, ex=None):
        self.data[key] = str(value)

    def delete(self, key: str):
        self.deleted.append(key)
        self.data.pop(key, None)


@pytest.fixture
def session_factory(tmp_path, monkeypatch) -> Iterator[sessionmaker[Session]]:
    engine = create_engine(f"sqlite:///{tmp_path / 'admin-controls.db'}")
    User.__table__.create(bind=engine)
    AdminUsageSettings.__table__.create(bind=engine)
    ApiKey.__table__.create(bind=engine)
    TokenUsageLog.__table__.create(bind=engine)
    UserServiceBalance.__table__.create(bind=engine)
    UserServiceTransaction.__table__.create(bind=engine)
    factory = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    with factory() as db:
        db.add(User(id=USER_ID, email="owner@example.com", name="Owner"))
        db.add(
            ApiKey(
                id=API_KEY_ID,
                user_id=USER_ID,
                api_key_hash=API_KEY_HASH,
                budget_micros=BUDGET_MICROS,
                budget_currency="USD",
                is_active=True,
            )
        )
        db.commit()

    monkeypatch.setattr(admin_router, "ensure_user_api_key", lambda _: API_KEY_HASH)
    yield factory
    engine.dispose()


def _log_cost(
    factory,
    cost_micros: int,
    *,
    request_id: str,
    route: str | None = None,
) -> None:
    with factory() as db:
        RateLimitRepository.log_token_usage(
            db,
            API_KEY_ID,
            0,
            "test-model",
            request_id,
            cost_micros=cost_micros,
            total_tokens=0,
            route=route,
        )


def _api_key(db) -> ApiKey:
    return db.query(ApiKey).filter(ApiKey.id == API_KEY_ID).one()


def _add_usage_log(
    db,
    *,
    created_at: datetime.datetime,
    request_id: str,
    total_tokens: int,
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    route: str | None = None,
) -> None:
    db.add(
        TokenUsageLog(
            chat_usage_id=API_KEY_ID,
            user_id=USER_ID,
            event_type="usage",
            delta_micros=0,
            cost_micros=0,
            tokens_used=total_tokens,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            route=route,
            request_id=request_id,
            actor_type="usage_meter",
            reason="chat_usage",
            created_at=created_at,
        )
    )


async def _adjust(factory, redis, delta_micros: int):
    with factory() as db:
        return admin_router.adjust_user_budget(
            USER_ID,
            admin_router.AdjustBudgetRequest(delta_micros=delta_micros),
            current_user=cast(User, ADMIN),
            db=db,
        )


STEP = admin_router.BUDGET_ADJUSTMENT_STEP_MICROS  # $5


def test_historical_map_cost_is_excluded_from_ai_usage(session_factory):
    _log_cost(session_factory, 500_000, request_id="ai-cost")
    _log_cost(
        session_factory,
        125_000,
        request_id="old-map-cost",
        route="map_search",
    )

    with session_factory() as db:
        totals = RateLimitRepository.get_period_usage_totals_for_user(
            db,
            user_id=USER_ID,
        )
        effective = RateLimitRepository.get_effective_cost_used_micros(
            db, api_key_id=API_KEY_ID
        )

    assert totals["cost_used_micros"] == 500_000
    assert totals["map_search_count"] == 1
    assert effective == 500_000


def test_period_usage_totals_only_include_logs_after_last_reset(session_factory):
    reset_at = datetime.datetime(2026, 1, 2, 12, 0, 0)
    with session_factory() as db:
        api_key = _api_key(db)
        api_key.last_reset_at = reset_at
        api_key.used_micros = 321
        _add_usage_log(
            db,
            created_at=reset_at - datetime.timedelta(minutes=1),
            request_id="before-reset",
            total_tokens=10,
            prompt_tokens=4,
            completion_tokens=6,
            route="map_search",
        )
        _add_usage_log(
            db,
            created_at=reset_at,
            request_id="at-reset",
            total_tokens=20,
            prompt_tokens=8,
            completion_tokens=12,
            route="map_search",
        )
        _add_usage_log(
            db,
            created_at=reset_at + datetime.timedelta(minutes=1),
            request_id="after-reset",
            total_tokens=30,
            prompt_tokens=12,
            completion_tokens=18,
        )
        db.commit()

        totals = RateLimitRepository.get_period_usage_totals_for_user(
            db,
            user_id=USER_ID,
        )

    assert totals["cost_used_micros"] == 321
    assert totals["tokens_used"] == 50
    assert totals["prompt_tokens_used"] == 20
    assert totals["completion_tokens_used"] == 30
    assert totals["total_tokens_used"] == 50
    assert totals["map_search_count"] == 1


def test_admin_usage_overview_only_includes_logs_after_last_reset(session_factory):
    reset_at = datetime.datetime(2026, 1, 2, 12, 0, 0)
    with session_factory() as db:
        api_key = _api_key(db)
        api_key.last_reset_at = reset_at
        api_key.used_micros = 456
        _add_usage_log(
            db,
            created_at=reset_at - datetime.timedelta(seconds=1),
            request_id="overview-before-reset",
            total_tokens=100,
            route="map_search",
        )
        _add_usage_log(
            db,
            created_at=reset_at + datetime.timedelta(seconds=1),
            request_id="overview-after-reset",
            total_tokens=25,
            route="map_search",
        )
        db.commit()

        rows = RateLimitRepository.list_user_usage_overview(db)

    owner_row = next(row for row in rows if row["id"] == USER_ID)
    assert owner_row["cost_used_micros"] == 456
    assert owner_row["total_tokens_used"] == 25
    assert owner_row["map_search_count"] == 1


@pytest.mark.anyio
async def test_admin_grant_is_idempotent_and_visible_in_history(session_factory):
    request = admin_router.GrantServiceCreditsRequest(
        amount=7,
        idempotency_key="grant-request-1",
    )
    with session_factory() as db:
        first = admin_router.grant_user_service_credits(
            USER_ID,
            request,
            current_user=cast(User, ADMIN),
            db=db,
        )
        duplicate = admin_router.grant_user_service_credits(
            USER_ID,
            request,
            current_user=cast(User, ADMIN),
            db=db,
        )
        history = admin_router.get_user_service_credits(USER_ID, limit=20, db=db)

    assert first.applied is True
    assert duplicate.applied is False
    assert duplicate.balance == 7
    assert history.balance == 7
    assert len(history.transactions) == 1
    assert history.transactions[0].actor_type == "admin"
    assert history.transactions[0].actor_id == ADMIN.id


@pytest.mark.anyio
async def test_grant_all_credits_every_user_and_is_idempotent(session_factory):
    with session_factory() as db:
        db.add(User(id="user-2", email="two@example.com", name="Two"))
        db.commit()

    request = admin_router.GrantServiceCreditsRequest(
        amount=50,
        idempotency_key="grant-all-1",
    )
    with session_factory() as db:
        first = admin_router.grant_all_service_credits(
            request, current_user=cast(User, ADMIN), db=db
        )
        duplicate = admin_router.grant_all_service_credits(
            request, current_user=cast(User, ADMIN), db=db
        )
        balances = {
            row.user_id: int(row.balance) for row in db.query(UserServiceBalance).all()
        }

    assert first.users_credited == 2
    assert first.users_skipped == 0
    assert duplicate.users_credited == 0
    assert duplicate.users_skipped == 2
    assert balances == {USER_ID: 50, "user-2": 50}


@pytest.mark.anyio
async def test_admin_user_overview_includes_credit_balance(session_factory):
    with session_factory() as db:
        admin_router.grant_user_service_credits(
            USER_ID,
            admin_router.GrantServiceCreditsRequest(
                amount=4,
                idempotency_key="overview-grant",
            ),
            current_user=cast(User, ADMIN),
            db=db,
        )
        response = admin_router.list_users(db=db)

    assert response.users[0].address_credit_balance == 4


@pytest.mark.anyio
async def test_admin_user_overview_includes_global_usage_settings(session_factory):
    with session_factory() as db:
        response = admin_router.list_users(db=db)

    assert response.global_settings.chat_budget_micros == 500_000
    assert response.global_settings.usage_reset_interval_days is None


@pytest.mark.anyio
async def test_usage_me_includes_address_credit_balance(session_factory, monkeypatch):
    monkeypatch.setattr(usage_router, "ensure_user_api_key", lambda _: API_KEY_HASH)
    monkeypatch.setattr(usage_router, "get_upstash_client", lambda: None)

    with session_factory() as db:
        admin_router.grant_user_service_credits(
            USER_ID,
            admin_router.GrantServiceCreditsRequest(
                amount=6,
                idempotency_key="usage-overview-grant",
            ),
            current_user=cast(User, ADMIN),
            db=db,
        )
        response = usage_router.get_my_usage(
            current_user=cast(User, db.query(User).filter(User.id == USER_ID).one()),
            db=db,
        )

    assert response.address_credit_balance == 6


@pytest.mark.anyio
async def test_global_usage_settings_update_applies_to_active_rows_and_logs(
    session_factory, monkeypatch, caplog
):
    other_user_id = "user-global-settings-other"
    other_api_key_id = "api-key-global-settings-other"
    other_api_key_hash = "hash-global-settings-other"
    redis = FakeRedis()
    monkeypatch.setattr(admin_router, "get_upstash_client", lambda: redis)
    caplog.set_level(logging.INFO, logger=admin_router.logger.name)

    with session_factory() as db:
        db.add(User(id=other_user_id, email="other@example.com", name="Other"))
        db.add(
            ApiKey(
                id=other_api_key_id,
                user_id=other_user_id,
                api_key_hash=other_api_key_hash,
                budget_micros=BUDGET_MICROS,
                budget_currency="USD",
                is_active=True,
            )
        )
        db.commit()

        response = admin_router.update_usage_settings(
            admin_router.UpdateUsageSettingsRequest(
                chat_budget_micros=1_250_000,
                usage_reset_interval_days=30,
            ),
            current_user=cast(User, ADMIN),
            db=db,
        )

        settings = db.query(AdminUsageSettings).one()
        usage_rows = db.query(ApiKey).order_by(ApiKey.id.asc()).all()
        logs = (
            db.query(TokenUsageLog)
            .filter(TokenUsageLog.event_type == "global_usage_settings_update")
            .all()
        )

    assert response.global_settings.chat_budget_micros == 1_250_000
    assert response.global_settings.usage_reset_interval_days == 30
    assert response.affected_user_count == 2
    assert response.changed_user_count == 2
    assert response.config_cache_cleared_count == 2
    assert settings.default_budget_micros == 1_250_000
    assert settings.default_usage_reset_interval_days == 30
    assert {row.budget_micros for row in usage_rows} == {1_250_000}
    assert {row.usage_reset_interval_days for row in usage_rows} == {30}
    assert {log.reason for log in logs} == {"global_usage_settings_update"}
    assert {
        log.metadata_json["changes"]["budget_micros"]["before"] for log in logs
    } == {BUDGET_MICROS}
    assert {log.metadata_json["changes"]["budget_micros"]["after"] for log in logs} == {
        1_250_000
    }
    assert {
        log.metadata_json["changes"]["usage_reset_interval_days"]["before"]
        for log in logs
    } == {None}
    assert {
        log.metadata_json["changes"]["usage_reset_interval_days"]["after"]
        for log in logs
    } == {30}
    assert f"{admin_router.CONFIG_KEY_PREFIX}{API_KEY_HASH}" in redis.deleted
    assert f"{admin_router.CONFIG_KEY_PREFIX}{other_api_key_hash}" in redis.deleted
    assert "Admin updated global usage settings" in caplog.text


@pytest.mark.anyio
async def test_global_usage_settings_update_does_not_move_last_reset_at(
    session_factory, monkeypatch
):
    monkeypatch.setattr(admin_router, "get_upstash_client", lambda: None)
    previous_reset_at = datetime.datetime(2026, 1, 1, 9, 30, 0)

    with session_factory() as db:
        api_key = _api_key(db)
        api_key.last_reset_at = previous_reset_at
        db.commit()

        admin_router.update_usage_settings(
            admin_router.UpdateUsageSettingsRequest(
                usage_reset_interval_days=30,
            ),
            current_user=cast(User, ADMIN),
            db=db,
        )

        api_key = _api_key(db)

    assert api_key.usage_reset_interval_days == 30
    assert api_key.last_reset_at == previous_reset_at


@pytest.mark.anyio
async def test_global_usage_settings_update_accepts_null_reset_interval(
    session_factory, monkeypatch
):
    monkeypatch.setattr(admin_router, "get_upstash_client", lambda: None)

    with session_factory() as db:
        db.query(ApiKey).filter(ApiKey.id == API_KEY_ID).update(
            {"usage_reset_interval_days": 30}
        )
        db.add(
            AdminUsageSettings(
                id="global",
                default_budget_micros=BUDGET_MICROS,
                default_usage_reset_interval_days=30,
            )
        )
        db.commit()

        response = admin_router.update_usage_settings(
            admin_router.UpdateUsageSettingsRequest(
                usage_reset_interval_days=None,
            ),
            current_user=cast(User, ADMIN),
            db=db,
        )

        settings = db.query(AdminUsageSettings).one()
        api_key = _api_key(db)

    assert response.global_settings.usage_reset_interval_days is None
    assert settings.default_usage_reset_interval_days is None
    assert api_key.usage_reset_interval_days is None

    with session_factory() as db:
        log = (
            db.query(TokenUsageLog)
            .filter(TokenUsageLog.event_type == "global_usage_settings_update")
            .order_by(TokenUsageLog.created_at.desc())
            .first()
        )

    assert log is not None
    assert log.metadata_json["changes"]["usage_reset_interval_days"] == {
        "before": 30,
        "after": None,
    }


@pytest.mark.anyio
async def test_plus_five_increases_lifetime_budget(session_factory, monkeypatch):
    redis = FakeRedis()
    redis.data[CONFIG_KEY] = "cached-config"
    monkeypatch.setattr(admin_router, "get_upstash_client", lambda: redis)
    _log_cost(session_factory, 1_000_000, request_id="req-a")  # $1 real usage

    resp = await _adjust(session_factory, redis, STEP)

    assert resp.cost_used_micros == 1_000_000
    assert resp.cost_budget_micros == 15_000_000
    assert resp.config_cache_cleared is True
    assert CONFIG_KEY in redis.deleted
    with session_factory() as db:
        assert _api_key(db).budget_micros == 15_000_000


@pytest.mark.anyio
async def test_minus_five_decreases_budget_and_doubles_percent_used(
    session_factory, monkeypatch
):
    redis = FakeRedis()
    monkeypatch.setattr(admin_router, "get_upstash_client", lambda: redis)
    _log_cost(session_factory, 2_000_000, request_id="req-b")  # 20% of $10

    resp = await _adjust(session_factory, redis, -STEP)

    assert resp.cost_used_micros == 2_000_000
    assert resp.cost_budget_micros == 5_000_000
    assert (resp.cost_used_micros / resp.cost_budget_micros) * 100 == 40
    assert COST_KEY not in redis.deleted
    with session_factory() as db:
        assert _api_key(db).budget_micros == 5_000_000


@pytest.mark.anyio
async def test_budget_adjustments_compound_and_clamp_at_zero(
    session_factory, monkeypatch
):
    redis = FakeRedis()
    monkeypatch.setattr(admin_router, "get_upstash_client", lambda: redis)

    first = await _adjust(session_factory, redis, -STEP)
    assert first.cost_budget_micros == 5_000_000
    second = await _adjust(session_factory, redis, -STEP)

    assert second.cost_budget_micros == 0
    with session_factory() as db:
        assert _api_key(db).budget_micros == 0


@pytest.mark.anyio
async def test_budget_adjustment_rejects_non_step_delta(session_factory, monkeypatch):
    redis = FakeRedis()
    monkeypatch.setattr(admin_router, "get_upstash_client", lambda: redis)

    with pytest.raises(HTTPException) as exc_info:
        await _adjust(session_factory, redis, 1_000_000)

    assert getattr(exc_info.value, "status_code", None) == 400
    assert redis.data == {}
    with session_factory() as db:
        assert _api_key(db).budget_micros == BUDGET_MICROS


@pytest.mark.anyio
async def test_reset_usage_keeps_budget_and_clears_cost_counter(
    session_factory, monkeypatch
):
    redis = FakeRedis()
    monkeypatch.setattr(admin_router, "get_upstash_client", lambda: redis)
    _log_cost(session_factory, 2_000_000, request_id="req-c")
    await _adjust(session_factory, redis, STEP)

    with session_factory() as db:
        resp = admin_router.reset_user_usage(
            USER_ID,
            current_user=cast(User, ADMIN),
            db=db,
        )

    assert resp.redis_cleared is True
    assert COST_KEY in redis.deleted
    with session_factory() as db:
        key = _api_key(db)
        assert key.budget_micros == 15_000_000
        assert key.last_reset_at is not None
        assert key.used_micros == 0
        assert (
            RateLimitRepository.get_effective_cost_used_micros(
                db, api_key_id=API_KEY_ID
            )
            == 0
        )
