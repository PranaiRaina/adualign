"""Scheduled reset logic for periodic chat usage budgets."""

from __future__ import annotations

import datetime
import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol

from pydantic import BaseModel
from sqlalchemy.orm import Session, sessionmaker

from api.database.core import SessionLocal
from api.database.models import ChatUsage
from api.database.repository import RateLimitRepository
from api.rate_limiting.rate_limiter import cost_usage_key, get_upstash_client

logger = logging.getLogger(__name__)

USAGE_RESET_BATCH_SIZE = 500
USAGE_RESET_ACTOR_TYPE = "system"
USAGE_RESET_ACTOR_ID = "usage-reset-sweep"


class UsageResetSweepResult(BaseModel):
    checked: int
    reset: int
    redis_cleared: int
    redis_errors: int


@dataclass(frozen=True)
class ResetUsageSnapshot:
    chat_usage_id: str
    api_key_hash: str


class RedisUsageCounterClient(Protocol):
    def delete(self, key: str) -> object: ...


def reset_due_chat_usage(
    *,
    now: datetime.datetime | None = None,
    batch_size: int = USAGE_RESET_BATCH_SIZE,
    session_factory: sessionmaker[Session] | Callable[[], Session] = SessionLocal,
    redis_client_factory: Callable[
        [], RedisUsageCounterClient | None
    ] = get_upstash_client,
) -> UsageResetSweepResult:
    reset_at = _as_utc(now or datetime.datetime.now(datetime.UTC))
    redis_client = redis_client_factory()
    result = UsageResetSweepResult(
        checked=0,
        reset=0,
        redis_cleared=0,
        redis_errors=0,
    )

    while True:
        with session_factory() as db:
            due_rows = RateLimitRepository.list_due_chat_usage_resets(
                db,
                now=reset_at,
                limit=batch_size,
            )
            result.checked += len(due_rows)
            if not due_rows:
                return result

            reset_rows = _reset_due_rows(db, due_rows, reset_at)
            result.reset += len(reset_rows)

        redis_cleared, redis_errors = _clear_usage_counters(redis_client, reset_rows)
        result.redis_cleared += redis_cleared
        result.redis_errors += redis_errors

        if len(due_rows) < batch_size:
            return result


def _reset_due_rows(
    db: Session,
    due_rows: list[ChatUsage],
    reset_at: datetime.datetime,
) -> list[ResetUsageSnapshot]:
    reset_rows: list[ResetUsageSnapshot] = []
    for chat_usage in due_rows:
        reset_row = RateLimitRepository.reset_chat_usage_if_due(
            db,
            chat_usage=chat_usage,
            reset_at=reset_at,
            actor_type=USAGE_RESET_ACTOR_TYPE,
            actor_id=USAGE_RESET_ACTOR_ID,
        )
        if reset_row is not None:
            reset_rows.append(
                ResetUsageSnapshot(
                    chat_usage_id=str(reset_row.id),
                    api_key_hash=str(reset_row.api_key_hash),
                )
            )
    return reset_rows


def _clear_usage_counters(
    redis_client: RedisUsageCounterClient | None,
    reset_rows: list[ResetUsageSnapshot],
) -> tuple[int, int]:
    if redis_client is None:
        return 0, 0

    cleared = 0
    errors = 0
    for reset_row in reset_rows:
        try:
            redis_client.delete(cost_usage_key(reset_row.api_key_hash))
            cleared += 1
        except Exception as exc:  # noqa: BLE001 - DB reset remains authoritative.
            errors += 1
            logger.error(
                "Scheduled usage reset persisted but Redis clear failed "
                "for chat_usage_id=%s: %s",
                reset_row.chat_usage_id,
                exc,
            )
    return cleared, errors


def _as_utc(value: datetime.datetime) -> datetime.datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=datetime.UTC)
    return value.astimezone(datetime.UTC)
