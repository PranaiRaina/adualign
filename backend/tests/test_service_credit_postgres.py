"""Postgres-only tests for the single-statement credit debit.

The debit's correctness relies on Postgres row locks and the partial unique
index on idempotency_key, which SQLite cannot exercise. These run when
TEST_POSTGRES_URL points at a database with the app schema applied (CI sets it
to the service container); otherwise they skip.
"""

from __future__ import annotations

import os
import threading
import uuid

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from api.database.models import User
from api.database.repository import (
    SERVICE_TYPE_ADDRESS_ACCESS,
    ServiceCreditRepository,
)

POSTGRES_URL = os.getenv("TEST_POSTGRES_URL")
pytestmark = pytest.mark.skipif(
    not POSTGRES_URL, reason="TEST_POSTGRES_URL not set (needs a real Postgres)"
)


@pytest.fixture(scope="module")
def session_factory():
    engine = create_engine(POSTGRES_URL, pool_size=25, max_overflow=0)
    yield sessionmaker(autocommit=False, autoflush=False, bind=engine)
    engine.dispose()


@pytest.fixture
def user_id(session_factory):
    uid = f"pg-credit-{uuid.uuid4()}"
    with session_factory() as db:
        db.add(User(id=uid, email=f"{uid}@example.com", name="PG Credit"))
        db.commit()
    yield uid
    with session_factory() as db:
        db.execute(text("DELETE FROM users WHERE id = :uid"), {"uid": uid})
        db.commit()


def _grant(session_factory, user_id: str, amount: int) -> None:
    with session_factory() as db:
        ServiceCreditRepository.grant_credits(
            db,
            user_id=user_id,
            service_type=SERVICE_TYPE_ADDRESS_ACCESS,
            amount=amount,
            reason="purchase",
            actor_type="system",
            idempotency_key=f"grant:{uuid.uuid4()}",
        )


def _debit(session_factory, user_id: str, key: str | None, amount: int = 1):
    with session_factory() as db:
        return ServiceCreditRepository.debit_credits(
            db,
            user_id=user_id,
            service_type=SERVICE_TYPE_ADDRESS_ACCESS,
            amount=amount,
            reason="map_search_charge",
            actor_type="user",
            actor_id=user_id,
            idempotency_key=key,
            metadata={"map_search_id": key},
        )


def _state(session_factory, user_id: str) -> tuple[int, int]:
    with session_factory() as db:
        balance = db.execute(
            text("SELECT balance FROM user_service_balances WHERE user_id = :u"),
            {"u": user_id},
        ).scalar_one()
        debits = db.execute(
            text(
                "SELECT count(*) FROM user_service_transactions "
                "WHERE user_id = :u AND delta < 0"
            ),
            {"u": user_id},
        ).scalar_one()
    return int(balance), int(debits)


def test_debit_applies_and_records_ledger_row(session_factory, user_id):
    _grant(session_factory, user_id, 3)

    result = _debit(session_factory, user_id, "k1")

    assert result is not None and result.applied
    assert int(result.balance.balance) == 2
    assert int(result.transaction.delta) == -1
    assert _state(session_factory, user_id) == (2, 1)


def test_debit_insufficient_balance_leaves_no_trace(session_factory, user_id):
    _grant(session_factory, user_id, 1)

    assert _debit(session_factory, user_id, "k1", amount=2) is None
    assert _state(session_factory, user_id) == (1, 0)


def test_debit_without_balance_row_returns_none(session_factory, user_id):
    assert _debit(session_factory, user_id, "k1") is None
    with session_factory() as db:
        rows = db.execute(
            text("SELECT count(*) FROM user_service_transactions WHERE user_id = :u"),
            {"u": user_id},
        ).scalar_one()
    assert rows == 0


def test_duplicate_idempotency_key_returns_original(session_factory, user_id):
    _grant(session_factory, user_id, 3)

    first = _debit(session_factory, user_id, "same-key")
    duplicate = _debit(session_factory, user_id, "same-key")

    assert first is not None and first.applied
    assert duplicate is not None and not duplicate.applied
    assert str(duplicate.transaction.transaction_id) == str(
        first.transaction.transaction_id
    )
    assert _state(session_factory, user_id) == (2, 1)


def test_unknown_user_raises(session_factory):
    with pytest.raises(ValueError):
        _debit(session_factory, f"missing-{uuid.uuid4()}", "k1")


def _race(n_threads: int, target) -> list:
    barrier = threading.Barrier(n_threads)
    results: list = [None] * n_threads

    def run(i: int) -> None:
        barrier.wait()
        results[i] = target(i)

    threads = [threading.Thread(target=run, args=(i,)) for i in range(n_threads)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return results


def test_concurrent_debits_never_overspend(session_factory, user_id):
    _grant(session_factory, user_id, 5)

    results = _race(20, lambda i: _debit(session_factory, user_id, f"race-{i}"))

    assert sum(1 for r in results if r is not None) == 5
    assert _state(session_factory, user_id) == (0, 5)


def test_concurrent_duplicate_key_debits_once(session_factory, user_id):
    _grant(session_factory, user_id, 5)

    results = _race(10, lambda i: _debit(session_factory, user_id, "dup-key"))

    assert sum(1 for r in results if r is not None and r.applied) == 1
    assert all(r is not None for r in results)
    assert _state(session_factory, user_id) == (4, 1)
