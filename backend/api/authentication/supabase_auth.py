from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
import os
from typing import Any

import jwt

SUPPORTED_JWT_ALGORITHMS = {"HS256", "RS256", "ES256"}
ASYMMETRIC_JWT_ALGORITHMS = {"RS256", "ES256"}


class SupabaseTokenVerificationError(Exception):
    """Raised when a bearer token cannot be verified."""


@dataclass(frozen=True)
class VerifiedSupabaseClaims:
    user_id: str
    email: str | None
    user_metadata: dict[str, Any]


@dataclass(frozen=True)
class SupabaseAuthSettings:
    issuer: str | None
    jwks_url: str | None
    jwt_secret: str | None


@lru_cache(maxsize=1)
def load_supabase_auth_settings() -> SupabaseAuthSettings:
    supabase_url = (
        os.getenv("SUPABASE_URL", "").strip()
        or os.getenv("NEXT_PUBLIC_SUPABASE_URL", "").strip()
    )
    jwt_secret = os.getenv("SUPABASE_JWT_SECRET", "").strip() or None

    if not supabase_url:
        return SupabaseAuthSettings(
            issuer=None,
            jwks_url=None,
            jwt_secret=jwt_secret,
        )

    normalized_url = supabase_url.rstrip("/")
    return SupabaseAuthSettings(
        issuer=f"{normalized_url}/auth/v1",
        jwks_url=f"{normalized_url}/auth/v1/.well-known/jwks.json",
        jwt_secret=jwt_secret,
    )


@lru_cache(maxsize=1)
def load_jwks_client() -> jwt.PyJWKClient:
    settings = load_supabase_auth_settings()
    if not settings.jwks_url:
        raise SupabaseTokenVerificationError(
            "Supabase URL is required to verify RS256 tokens."
        )
    return jwt.PyJWKClient(settings.jwks_url)


def verify_supabase_access_token(token: str) -> VerifiedSupabaseClaims:
    algorithm = read_token_algorithm(token)
    payload = decode_verified_token_payload(token, algorithm)
    user_id = payload.get("sub")
    if not isinstance(user_id, str) or not user_id.strip():
        raise SupabaseTokenVerificationError("Token is missing a valid subject.")

    email = payload.get("email")
    user_metadata = payload.get("user_metadata")
    return VerifiedSupabaseClaims(
        user_id=user_id.strip(),
        email=email if isinstance(email, str) and email.strip() else None,
        user_metadata=user_metadata if isinstance(user_metadata, dict) else {},
    )


def read_token_algorithm(token: str) -> str:
    try:
        algorithm = jwt.get_unverified_header(token).get("alg")
    except jwt.InvalidTokenError as exc:
        raise SupabaseTokenVerificationError("Token header is invalid.") from exc

    if algorithm not in SUPPORTED_JWT_ALGORITHMS:
        raise SupabaseTokenVerificationError("Token algorithm is not supported.")
    return algorithm


def decode_verified_token_payload(token: str, algorithm: str) -> dict[str, Any]:
    settings = load_supabase_auth_settings()
    decode_kwargs: dict[str, Any] = {
        "algorithms": [algorithm],
        "options": {"require": ["exp", "sub"], "verify_aud": False},
    }
    if settings.issuer:
        decode_kwargs["issuer"] = settings.issuer

    try:
        if algorithm in ASYMMETRIC_JWT_ALGORITHMS:
            signing_key = load_jwks_client().get_signing_key_from_jwt(token)
            payload = jwt.decode(token, signing_key.key, **decode_kwargs)
        else:
            if not settings.jwt_secret:
                raise SupabaseTokenVerificationError(
                    "SUPABASE_JWT_SECRET is required to verify HS256 tokens."
                )
            payload = jwt.decode(token, settings.jwt_secret, **decode_kwargs)
    except SupabaseTokenVerificationError:
        raise
    except jwt.InvalidTokenError as exc:
        raise SupabaseTokenVerificationError("Token verification failed.") from exc

    if not isinstance(payload, dict):
        raise SupabaseTokenVerificationError("Token payload is invalid.")
    return payload
