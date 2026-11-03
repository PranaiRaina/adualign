from __future__ import annotations

from collections.abc import Iterator

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from api.authentication import auth
from api.authentication.supabase_auth import VerifiedSupabaseClaims
from api.database.models import User, UserServiceBalance, UserServiceTransaction
from api.database.repository import SIGNUP_ADDRESS_CREDIT_AMOUNT


@pytest.fixture
def db_session(tmp_path) -> Iterator[Session]:
    engine = create_engine(f"sqlite:///{tmp_path / 'auth-credits.db'}")
    User.__table__.create(bind=engine)
    UserServiceBalance.__table__.create(bind=engine)
    UserServiceTransaction.__table__.create(bind=engine)
    factory = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    with factory() as db:
        yield db
    engine.dispose()


def _claims(user_id: str) -> VerifiedSupabaseClaims:
    return VerifiedSupabaseClaims(
        user_id=user_id,
        email=f"{user_id}@example.com",
        user_metadata={"name": "Credit Test"},
    )


def test_existing_account_receives_missing_signup_credits(db_session, monkeypatch):
    claims = _claims("existing-user")
    db_session.add(User(id=claims.user_id, email=claims.email, name="Existing"))
    db_session.commit()
    monkeypatch.setattr(auth, "verify_supabase_access_token", lambda _: claims)

    user = auth.resolve_current_user_from_token("token", db_session)

    balance = db_session.query(UserServiceBalance).one()
    transaction = db_session.query(UserServiceTransaction).one()
    assert user.id == claims.user_id
    assert balance.balance == SIGNUP_ADDRESS_CREDIT_AMOUNT
    assert transaction.delta == SIGNUP_ADDRESS_CREDIT_AMOUNT
    assert transaction.reason == "signup_bonus"


def test_new_account_receives_signup_bonus_credits(db_session, monkeypatch):
    claims = _claims("new-user")
    monkeypatch.setattr(auth, "verify_supabase_access_token", lambda _: claims)

    user = auth.resolve_current_user_from_token("token", db_session)

    balance = db_session.query(UserServiceBalance).one()
    transaction = db_session.query(UserServiceTransaction).one()
    assert user.id == claims.user_id
    assert balance.balance == SIGNUP_ADDRESS_CREDIT_AMOUNT
    assert transaction.delta == SIGNUP_ADDRESS_CREDIT_AMOUNT
    assert transaction.reason == "signup_bonus"


def test_new_account_bootstrap_is_idempotent(db_session, monkeypatch):
    claims = _claims("bootstrapped-user")
    monkeypatch.setattr(auth, "verify_supabase_access_token", lambda _: claims)

    first_user = auth.resolve_current_user_from_token("token", db_session)
    second_user = auth.resolve_current_user_from_token("token", db_session)

    balance = db_session.query(UserServiceBalance).one()
    transactions = db_session.query(UserServiceTransaction).all()
    assert first_user.id == claims.user_id
    assert second_user.id == claims.user_id
    assert balance.balance == SIGNUP_ADDRESS_CREDIT_AMOUNT
    assert len(transactions) == 1


def test_zombie_token_of_deleted_auth_user_is_rejected(db_session, monkeypatch):
    # A deleted account's JWT stays valid ~1h; provisioning must refuse to
    # resurrect the public.users row instead of re-creating it.
    claims = _claims("deleted-user")
    monkeypatch.setattr(auth, "verify_supabase_access_token", lambda _: claims)
    monkeypatch.setattr(auth, "_auth_user_exists", lambda db, uid: False)

    with pytest.raises(auth.HTTPException) as exc_info:
        auth.resolve_current_user_from_token("token", db_session)

    assert exc_info.value.status_code == 401
    assert db_session.query(User).count() == 0


def test_orphaned_email_row_is_taken_over_by_new_auth_user(db_session, monkeypatch):
    # A dead account left a row holding the email; the new auth user with the
    # same email replaces it.
    email = "shared@example.com"
    db_session.add(User(id="old-dead-id", email=email, name="Old"))
    db_session.commit()

    claims = VerifiedSupabaseClaims(
        user_id="new-live-id", email=email, user_metadata={"name": "New"}
    )
    monkeypatch.setattr(auth, "verify_supabase_access_token", lambda _: claims)
    monkeypatch.setattr(auth, "_auth_user_exists", lambda db, uid: uid == "new-live-id")

    user = auth.resolve_current_user_from_token("token", db_session)

    assert user.id == "new-live-id"
    rows = db_session.query(User).all()
    assert [(r.id, r.email) for r in rows] == [("new-live-id", email)]


def test_email_conflict_with_live_account_is_not_taken_over(db_session, monkeypatch):
    # If the conflicting row's auth user still exists, keep it and fail as before.
    email = "shared@example.com"
    db_session.add(User(id="live-owner-id", email=email, name="Owner"))
    db_session.commit()

    claims = VerifiedSupabaseClaims(
        user_id="intruder-id", email=email, user_metadata={"name": "Intruder"}
    )
    monkeypatch.setattr(auth, "verify_supabase_access_token", lambda _: claims)
    # default _auth_user_exists: everyone alive on sqlite

    with pytest.raises(auth.HTTPException) as exc_info:
        auth.resolve_current_user_from_token("token", db_session)

    assert exc_info.value.status_code == 500
    rows = db_session.query(User).all()
    assert [(r.id, r.email) for r in rows] == [("live-owner-id", email)]
