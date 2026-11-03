# mypy: disable-error-code="arg-type"

from collections.abc import Iterator
from contextlib import contextmanager
from typing import cast

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from api.database.models import (
    Project,
    User,
    UserServiceBalance,
    UserServiceTransaction,
)
from api.database.repository import (
    SERVICE_TYPE_ADDRESS_ACCESS,
    SIGNUP_ADDRESS_CREDIT_AMOUNT,
    ServiceCreditRepository,
)


def _user_id(user: User) -> str:
    return cast(str, user.id)


def _create_user(db: Session, *, email: str) -> User:
    user = User(email=email, name=email.split("@")[0])
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


class TestServiceCreditRepository:
    def test_signup_grant_is_idempotent(self):
        with self._session() as db:
            user = _create_user(db, email="signup@example.com")
            first = ServiceCreditRepository.grant_signup_credits(
                db, user_id=str(user.id)
            )
            duplicate = ServiceCreditRepository.grant_signup_credits(
                db, user_id=str(user.id)
            )

            assert first.applied is True
            assert duplicate.applied is False
            assert duplicate.balance.balance == SIGNUP_ADDRESS_CREDIT_AMOUNT

    def test_existing_ten_credit_signup_grant_survives_policy_change(self):
        with self._session() as db:
            user = _create_user(db, email="legacy-signup@example.com")
            user_id = _user_id(user)
            ServiceCreditRepository.grant_credits(
                db,
                user_id=user_id,
                service_type=SERVICE_TYPE_ADDRESS_ACCESS,
                amount=10,
                reason="signup_bonus",
                actor_type="system",
                idempotency_key=f"signup_bonus:{user_id}:v1",
            )

            result = ServiceCreditRepository.grant_signup_credits(db, user_id=user_id)

            assert result.applied is False
            assert result.balance.balance == 10
            assert db.query(UserServiceTransaction).count() == 1

    def setup_method(self) -> None:
        self._engine = create_engine("sqlite:///:memory:")
        User.__table__.create(bind=self._engine)
        Project.__table__.create(bind=self._engine)
        UserServiceBalance.__table__.create(bind=self._engine)
        UserServiceTransaction.__table__.create(bind=self._engine)
        self._session_factory = sessionmaker(
            autocommit=False, autoflush=False, bind=self._engine
        )

    def teardown_method(self) -> None:
        self._engine.dispose()

    @contextmanager
    def _session(self) -> Iterator[Session]:
        db = self._session_factory()
        try:
            yield db
        finally:
            db.close()

    def test_first_credit_grant_creates_balance_and_transaction(self):
        with self._session() as db:
            user = _create_user(db, email="owner@example.com")

            result = ServiceCreditRepository.grant_credits(
                db,
                user_id=_user_id(user),
                service_type=SERVICE_TYPE_ADDRESS_ACCESS,
                amount=5,
                reason="admin_adjustment",
                actor_type="admin",
                actor_id="admin-1",
                idempotency_key="grant-1",
            )

            assert result.applied is True
            assert result.balance.balance == 5
            assert result.balance.last_updated_by_actor_type == "admin"
            assert result.balance.last_updated_by_actor_id == "admin-1"
            assert result.transaction.delta == 5
            assert result.transaction.actor_type == "admin"

    def test_second_credit_grant_increments_existing_balance(self):
        with self._session() as db:
            user = _create_user(db, email="owner@example.com")
            ServiceCreditRepository.grant_credits(
                db,
                user_id=_user_id(user),
                service_type=SERVICE_TYPE_ADDRESS_ACCESS,
                amount=5,
                reason="purchase",
                actor_type="webhook",
                actor_id="stripe",
                idempotency_key="grant-1",
            )

            result = ServiceCreditRepository.grant_credits(
                db,
                user_id=_user_id(user),
                service_type=SERVICE_TYPE_ADDRESS_ACCESS,
                amount=3,
                reason="purchase",
                actor_type="webhook",
                actor_id="stripe",
                idempotency_key="grant-2",
            )

            assert result.balance.balance == 8

    def test_duplicate_credit_grant_is_deduped(self):
        with self._session() as db:
            user = _create_user(db, email="owner@example.com")
            first = ServiceCreditRepository.grant_credits(
                db,
                user_id=_user_id(user),
                service_type=SERVICE_TYPE_ADDRESS_ACCESS,
                amount=5,
                reason="purchase",
                actor_type="webhook",
                actor_id="stripe",
                idempotency_key="grant-1",
            )

            duplicate = ServiceCreditRepository.grant_credits(
                db,
                user_id=_user_id(user),
                service_type=SERVICE_TYPE_ADDRESS_ACCESS,
                amount=5,
                reason="purchase",
                actor_type="webhook",
                actor_id="stripe",
                idempotency_key="grant-1",
            )

            assert duplicate.applied is False
            assert duplicate.balance.balance == 5
            assert (
                duplicate.transaction.transaction_id == first.transaction.transaction_id
            )
            assert db.query(UserServiceTransaction).count() == 1

    def test_debit_fails_without_balance_row(self):
        with self._session() as db:
            user = _create_user(db, email="owner@example.com")

            result = ServiceCreditRepository.debit_credits(
                db,
                user_id=_user_id(user),
                service_type=SERVICE_TYPE_ADDRESS_ACCESS,
                amount=1,
                reason="map_search_charge",
                actor_type="user",
                actor_id=_user_id(user),
                idempotency_key="debit-1",
            )

            assert result is None
            assert db.query(UserServiceTransaction).count() == 0

    def test_debit_fails_with_insufficient_balance(self):
        with self._session() as db:
            user = _create_user(db, email="owner@example.com")
            ServiceCreditRepository.grant_credits(
                db,
                user_id=_user_id(user),
                service_type=SERVICE_TYPE_ADDRESS_ACCESS,
                amount=1,
                reason="admin_adjustment",
                actor_type="admin",
                actor_id="admin-1",
                idempotency_key="grant-1",
            )

            result = ServiceCreditRepository.debit_credits(
                db,
                user_id=_user_id(user),
                service_type=SERVICE_TYPE_ADDRESS_ACCESS,
                amount=2,
                reason="map_search_charge",
                actor_type="user",
                actor_id=_user_id(user),
                idempotency_key="debit-1",
            )

            assert result is None
            balance = ServiceCreditRepository.get_balance(
                db,
                user_id=_user_id(user),
                service_type=SERVICE_TYPE_ADDRESS_ACCESS,
            )
            assert balance is not None
            assert balance.balance == 1

    def test_debit_succeeds_and_records_actor_fields(self):
        with self._session() as db:
            user = _create_user(db, email="owner@example.com")
            ServiceCreditRepository.grant_credits(
                db,
                user_id=_user_id(user),
                service_type=SERVICE_TYPE_ADDRESS_ACCESS,
                amount=2,
                reason="purchase",
                actor_type="webhook",
                actor_id="stripe",
                idempotency_key="grant-1",
            )

            result = ServiceCreditRepository.debit_credits(
                db,
                user_id=_user_id(user),
                service_type=SERVICE_TYPE_ADDRESS_ACCESS,
                amount=1,
                reason="map_search_charge",
                actor_type="user",
                actor_id=_user_id(user),
                idempotency_key="debit-1",
                request_id="request-1",
            )

            assert result is not None
            assert result.applied is True
            assert result.balance.balance == 1
            assert result.balance.last_updated_by_actor_type == "user"
            assert result.transaction.delta == -1
            assert result.transaction.request_id == "request-1"

    def test_duplicate_debit_is_deduped(self):
        with self._session() as db:
            user = _create_user(db, email="owner@example.com")
            ServiceCreditRepository.grant_credits(
                db,
                user_id=_user_id(user),
                service_type=SERVICE_TYPE_ADDRESS_ACCESS,
                amount=2,
                reason="purchase",
                actor_type="webhook",
                actor_id="stripe",
                idempotency_key="grant-1",
            )
            first = ServiceCreditRepository.debit_credits(
                db,
                user_id=_user_id(user),
                service_type=SERVICE_TYPE_ADDRESS_ACCESS,
                amount=1,
                reason="map_search_charge",
                actor_type="user",
                actor_id=_user_id(user),
                idempotency_key="debit-1",
            )

            duplicate = ServiceCreditRepository.debit_credits(
                db,
                user_id=_user_id(user),
                service_type=SERVICE_TYPE_ADDRESS_ACCESS,
                amount=1,
                reason="map_search_charge",
                actor_type="user",
                actor_id=_user_id(user),
                idempotency_key="debit-1",
            )

            assert first is not None
            assert duplicate is not None
            assert duplicate.applied is False
            assert duplicate.balance.balance == 1
            assert (
                duplicate.transaction.transaction_id == first.transaction.transaction_id
            )
