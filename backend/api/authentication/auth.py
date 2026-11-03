import logging

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..database.core import get_db
from ..database.models import User
from ..database.repository import ServiceCreditRepository
from ..schemas import UserProfile
from .supabase_auth import (
    SupabaseTokenVerificationError,
    VerifiedSupabaseClaims,
    verify_supabase_access_token,
)

# Reuse the same scheme for compatibility with existing Swagger/Docs
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/token")

router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger(__name__)


def _build_credentials_exception() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )


def resolve_current_user_from_token(token: str, db: Session) -> User:
    try:
        claims = verify_supabase_access_token(token)
    except SupabaseTokenVerificationError as exc:
        logger.warning("JWT verification failed: %s", exc)
        raise _build_credentials_exception() from exc

    user = db.query(User).filter(User.id == claims.user_id).first()
    if user is not None:
        ensure_signup_address_credits(db, user_id=str(user.id))
        return user

    return provision_verified_user(db, claims)


def _extract_bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise _build_credentials_exception()
    return token


def get_user_from_authorization_header(
    authorization: str | None,
    db: Session,
    *,
    required: bool,
) -> User | None:
    token = _extract_bearer_token(authorization)
    if token is None:
        if required:
            raise _build_credentials_exception()
        return None
    return resolve_optional_user_from_token(token, db, required=required)


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    return resolve_current_user_from_token(token, db)


def resolve_optional_user_from_token(
    token: str,
    db: Session,
    *,
    required: bool,
) -> User | None:
    try:
        return resolve_current_user_from_token(token, db)
    except HTTPException as exc:
        if not required and exc.status_code == status.HTTP_401_UNAUTHORIZED:
            logger.info("Ignoring invalid bearer token on optional auth path")
            return None
        raise


def _auth_user_exists(db: Session, user_id: str) -> bool:
    """True if the Supabase auth.users row still exists.

    A verified JWT alone doesn't prove the account is alive: tokens stay
    valid ~1h after the auth user is deleted.
    """
    # ponytail: sqlite tests have no auth schema; treat as alive there and
    # monkeypatch this helper for the negative cases.
    if db.get_bind().dialect.name != "postgresql":
        return True
    row = db.execute(
        text("SELECT 1 FROM auth.users WHERE id = CAST(:uid AS uuid)"),
        {"uid": user_id},
    ).first()
    return row is not None


def _insert_user(db: Session, claims: VerifiedSupabaseClaims, email: str) -> User:
    user = User(
        id=claims.user_id,
        email=email,
        name=build_user_name(claims),
        avatar_url=read_avatar_url(claims),
        role="buyer",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def provision_verified_user(db: Session, claims: VerifiedSupabaseClaims) -> User:
    # Zombie token: the auth user was deleted but its JWT is still valid.
    # Refuse instead of resurrecting the public.users row. Runs on the
    # insert path only, so normal requests pay nothing extra.
    if not _auth_user_exists(db, claims.user_id):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Account no longer exists",
        )

    email = claims.email or f"{claims.user_id}@placeholder.com"
    try:
        user = _insert_user(db, claims, email)
    except Exception as exc:
        db.rollback()
        existing_user = db.query(User).filter(User.id == claims.user_id).first()
        user = (
            existing_user
            if existing_user is not None
            else _takeover_orphaned_email(db, claims, email, exc)
        )

    ensure_signup_address_credits(db, user_id=str(user.id))
    return user


def _takeover_orphaned_email(
    db: Session, claims: VerifiedSupabaseClaims, email: str, cause: Exception
) -> User:
    """Retry provisioning when the email is held by a dead account's row.

    The insert failed and no row carries our id, so the likely culprit is the
    email UNIQUE constraint hitting a row a deleted account left behind. The
    takeover is gated on that row's auth user being truly gone — a live
    conflicting account keeps its row and we fail exactly as before.
    """
    orphan = db.query(User).filter(User.email == email).first()
    if orphan is None or _auth_user_exists(db, str(orphan.id)):
        logger.exception("User provisioning failed for %s", claims.user_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="User provisioning failed",
        ) from cause

    logger.warning(
        "Deleting orphaned user row %s to free %s for %s",
        orphan.id,
        email,
        claims.user_id,
    )
    # Bulk delete: DB-level FK rules handle children (ORM cascade would try to
    # load every relationship).
    db.query(User).filter(User.id == orphan.id).delete()
    db.commit()
    try:
        return _insert_user(db, claims, email)
    except Exception as retry_exc:
        db.rollback()
        logger.exception("User provisioning retry failed for %s", claims.user_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="User provisioning failed",
        ) from retry_exc


# User ids whose signup grant is known to exist. The ledger is append-only and
# Supabase user ids are never reused, so once confirmed this stays true for the
# life of the process; skipping the check saves two queries on every
# authenticated request. Per-process and bounded: a miss just re-checks.
_SIGNUP_GRANT_CONFIRMED: set[str] = set()
_SIGNUP_GRANT_CONFIRMED_MAX = 50_000


def ensure_signup_address_credits(db: Session, *, user_id: str) -> None:
    if user_id in _SIGNUP_GRANT_CONFIRMED:
        return
    try:
        ServiceCreditRepository.grant_signup_credits(db, user_id=user_id)
        if len(_SIGNUP_GRANT_CONFIRMED) >= _SIGNUP_GRANT_CONFIRMED_MAX:
            _SIGNUP_GRANT_CONFIRMED.clear()
        _SIGNUP_GRANT_CONFIRMED.add(user_id)
    except Exception as exc:
        logger.exception("Signup credit grant failed for %s", user_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="User credit provisioning failed",
        ) from exc


def build_user_name(claims: VerifiedSupabaseClaims) -> str:
    metadata = claims.user_metadata
    full_name = metadata.get("full_name")
    if isinstance(full_name, str) and full_name.strip():
        return full_name.strip()

    name = metadata.get("name")
    if isinstance(name, str) and name.strip():
        return name.strip()

    if claims.email:
        return claims.email.split("@")[0]

    return claims.user_id


def read_avatar_url(claims: VerifiedSupabaseClaims) -> str | None:
    avatar_url = claims.user_metadata.get("avatar_url")
    if isinstance(avatar_url, str) and avatar_url.strip():
        return avatar_url.strip()
    return None


@router.get("/me", response_model=UserProfile)
def read_users_me(current_user: User = Depends(get_current_user)):
    return {
        "id": current_user.id,
        "name": current_user.name,
        "email": current_user.email,
        "role": current_user.role,
        "avatarUrl": current_user.avatar_url,
    }
