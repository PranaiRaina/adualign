from __future__ import annotations

import datetime
from collections.abc import Iterator

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from api.database.models import ApiKey, TokenUsageLog, User
from api.rate_limiting.rate_limiter import cost_usage_key
from api.rate_limiting.usage_resets import UsageResetSweepResult, reset_due_chat_usage

NOW = datetime.datetime(2026, 6, 23, 12, 0, tzinfo=datetime.UTC)


class FakeRedis:
    def __init__(self, *, delete_error: Exception | None = None) -> None:
        self.deleted: list[str] = []
        self.delete_error = delete_error

    def delete(self, key: str) -> None:
        if self.delete_error is not None:
            raise self.delete_error
        self.deleted.append(key)


@pytest.fixture
def session_factory(tmp_path) -> Iterator[sessionmaker[Session]]:
    engine = create_engine(f"sqlite:///{tmp_path / 'usage-resets.db'}")
    User.__table__.create(bind=engine)
    ApiKey.__table__.create(bind=engine)
    TokenUsageLog.__table__.create(bind=engine)
    factory = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    yield factory
    engine.dispose()


def test_reset_due_chat_usage_resets_due_rows_and_clears_redis(session_factory):
    _create_usage(
        session_factory,
        user_id="due-user",
        chat_usage_id="due-usage",
        api_key_hash="due-hash",
        used_micros=4_000,
        interval_days=7,
        last_reset_at=NOW - datetime.timedelta(days=8),
    )
    redis = FakeRedis()

    result = reset_due_chat_usage(
        now=NOW,
        session_factory=session_factory,
        redis_client_factory=lambda: redis,
    )

    with session_factory() as db:
        usage = db.query(ApiKey).filter(ApiKey.id == "due-usage").one()
        log = (
            db.query(TokenUsageLog)
            .filter(TokenUsageLog.chat_usage_id == usage.id)
            .one()
        )

    assert result.reset == 1
    assert result.redis_cleared == 1
    assert usage.used_micros == 0
    assert usage.last_reset_at == NOW.replace(tzinfo=None)
    assert log.event_type == "usage_reset"
    assert log.delta_micros == -4_000
    assert redis.deleted == [cost_usage_key("due-hash")]


def test_reset_due_chat_usage_clears_redis_for_multiple_due_rows(session_factory):
    _create_usage(
        session_factory,
        user_id="due-user-a",
        chat_usage_id="due-usage-a",
        api_key_hash="due-hash-a",
        used_micros=4_000,
        interval_days=7,
        last_reset_at=NOW - datetime.timedelta(days=8),
    )
    _create_usage(
        session_factory,
        user_id="due-user-b",
        chat_usage_id="due-usage-b",
        api_key_hash="due-hash-b",
        used_micros=6_000,
        interval_days=7,
        last_reset_at=NOW - datetime.timedelta(days=8),
    )
    redis = FakeRedis()

    result = reset_due_chat_usage(
        now=NOW,
        session_factory=session_factory,
        redis_client_factory=lambda: redis,
        batch_size=2,
    )

    assert result.checked == 2
    assert result.reset == 2
    assert result.redis_cleared == 2
    assert redis.deleted == [
        cost_usage_key("due-hash-a"),
        cost_usage_key("due-hash-b"),
    ]


def test_reset_due_chat_usage_uses_created_at_when_last_reset_is_null(
    session_factory,
):
    _create_usage(
        session_factory,
        user_id="created-anchor-user",
        chat_usage_id="created-anchor-usage",
        api_key_hash="created-anchor-hash",
        used_micros=2_000,
        interval_days=30,
        created_at=NOW - datetime.timedelta(days=31),
        last_reset_at=None,
    )

    result = reset_due_chat_usage(
        now=NOW,
        session_factory=session_factory,
        redis_client_factory=lambda: None,
    )

    with session_factory() as db:
        usage = db.query(ApiKey).filter(ApiKey.id == "created-anchor-usage").one()

    assert result.reset == 1
    assert usage.used_micros == 0
    assert usage.last_reset_at == NOW.replace(tzinfo=None)


def test_reset_due_chat_usage_skips_null_and_not_due_intervals(session_factory):
    _create_usage(
        session_factory,
        user_id="null-interval-user",
        chat_usage_id="null-interval-usage",
        api_key_hash="null-interval-hash",
        used_micros=1_000,
        interval_days=None,
        last_reset_at=NOW - datetime.timedelta(days=90),
    )
    _create_usage(
        session_factory,
        user_id="not-due-user",
        chat_usage_id="not-due-usage",
        api_key_hash="not-due-hash",
        used_micros=1_500,
        interval_days=30,
        last_reset_at=NOW - datetime.timedelta(days=10),
    )

    result = reset_due_chat_usage(
        now=NOW,
        session_factory=session_factory,
        redis_client_factory=lambda: None,
    )

    with session_factory() as db:
        rows = db.query(ApiKey).order_by(ApiKey.id).all()

    assert result.reset == 0
    assert sorted(row.used_micros for row in rows) == [1_000, 1_500]


def test_reset_due_chat_usage_is_idempotent(session_factory):
    _create_usage(
        session_factory,
        user_id="idempotent-user",
        chat_usage_id="idempotent-usage",
        api_key_hash="idempotent-hash",
        used_micros=3_000,
        interval_days=1,
        last_reset_at=NOW - datetime.timedelta(days=2),
    )

    first = reset_due_chat_usage(
        now=NOW,
        session_factory=session_factory,
        redis_client_factory=lambda: None,
    )
    second = reset_due_chat_usage(
        now=NOW,
        session_factory=session_factory,
        redis_client_factory=lambda: None,
    )

    with session_factory() as db:
        log_count = db.query(TokenUsageLog).count()

    assert first.reset == 1
    assert second.reset == 0
    assert log_count == 1


def test_reset_due_chat_usage_keeps_db_reset_when_redis_delete_fails(
    session_factory,
):
    _create_usage(
        session_factory,
        user_id="redis-fail-user",
        chat_usage_id="redis-fail-usage",
        api_key_hash="redis-fail-hash",
        used_micros=9_000,
        interval_days=1,
        last_reset_at=NOW - datetime.timedelta(days=2),
    )
    redis = FakeRedis(delete_error=RuntimeError("redis unavailable"))

    result = reset_due_chat_usage(
        now=NOW,
        session_factory=session_factory,
        redis_client_factory=lambda: redis,
    )

    with session_factory() as db:
        usage = db.query(ApiKey).filter(ApiKey.id == "redis-fail-usage").one()

    assert result.reset == 1
    assert result.redis_errors == 1
    assert usage.used_micros == 0


def test_internal_endpoint_requires_cron_secret(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from api.routers import internal

    app = FastAPI()
    app.include_router(internal.router)
    client = TestClient(app)

    monkeypatch.delenv("CRON_SECRET", raising=False)
    assert client.post("/internal/usage-resets/run").status_code == 503

    monkeypatch.setenv("CRON_SECRET", "expected-secret")
    assert client.post("/internal/usage-resets/run").status_code == 401
    assert (
        client.post(
            "/internal/usage-resets/run",
            headers={"X-Cron-Secret": "wrong-secret"},
        ).status_code
        == 401
    )


def test_internal_endpoint_runs_sweep_and_logs_summary(monkeypatch, caplog):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from api.routers import internal

    monkeypatch.setenv("CRON_SECRET", "expected-secret")
    monkeypatch.setattr(
        internal,
        "reset_due_chat_usage",
        lambda: UsageResetSweepResult(
            checked=5,
            reset=2,
            redis_cleared=2,
            redis_errors=0,
        ),
    )

    app = FastAPI()
    app.include_router(internal.router)
    client = TestClient(app)

    with caplog.at_level("INFO"):
        response = client.post(
            "/internal/usage-resets/run",
            headers={"X-Cron-Secret": "expected-secret"},
        )

    assert response.status_code == 200
    assert response.json() == {
        "checked": 5,
        "reset": 2,
        "redis_cleared": 2,
        "redis_errors": 0,
    }
    assert "Usage reset sweep completed" in caplog.text


def _create_usage(
    factory: sessionmaker[Session],
    *,
    user_id: str,
    chat_usage_id: str,
    api_key_hash: str,
    used_micros: int,
    interval_days: int | None,
    created_at: datetime.datetime | None = None,
    last_reset_at: datetime.datetime | None,
) -> None:
    created_at = created_at or NOW - datetime.timedelta(days=60)
    with factory() as db:
        db.add(User(id=user_id, email=f"{user_id}@example.com", name=user_id))
        db.add(
            ApiKey(
                id=chat_usage_id,
                user_id=user_id,
                api_key_hash=api_key_hash,
                budget_micros=10_000,
                budget_currency="USD",
                used_micros=used_micros,
                usage_reset_interval_days=interval_days,
                last_reset_at=last_reset_at,
                is_active=True,
                created_at=created_at,
            )
        )
        db.commit()
