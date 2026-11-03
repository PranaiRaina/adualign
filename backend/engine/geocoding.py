"""
Mapbox reverse geocoding helpers.

Looks up the county for a coordinate using Mapbox Geocoding v6.
Never raises — returns ``None`` when the token is missing, the request
fails, or Mapbox does not return a district/county value.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

import httpx

from api.cache.keys import build_cache_key, rounded_lat_lng_id
from api.cache.redis_cache import get_cache
from api.config.cache_settings import get_cache_settings
from api.http_client import shared_async_client

logger = logging.getLogger(__name__)

MAPBOX_REVERSE_GEOCODE_URL = "https://api.mapbox.com/search/geocode/v6/reverse"
MAPBOX_REQUEST_TIMEOUT_SECONDS = 4.0
COUNTY_CACHE_COORDINATE_DECIMALS = 5
MAPBOX_TOKEN_ENV_NAMES = (
    "MAPBOX_ACCESS_TOKEN",
    "NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN",
    "NEXT_PUBLIC_MAPBOX_TOKEN",
)


def get_mapbox_access_token() -> str:
    for env_name in MAPBOX_TOKEN_ENV_NAMES:
        token = os.getenv(env_name, "").strip()
        if token:
            return token

    for env_path in _env_search_paths():
        token = _read_env_value(env_path, MAPBOX_TOKEN_ENV_NAMES)
        if token:
            return token

    return ""


async def lookup_county_by_coords(lat: float, lng: float) -> str | None:
    token = get_mapbox_access_token()
    if not token:
        logger.warning(
            "Mapbox token missing; skipping county lookup for lat=%s lng=%s",
            lat,
            lng,
        )
        return None

    cache_settings = get_cache_settings()
    cache_key = _build_county_cache_key(cache_settings.redis_prefix, lat, lng)
    cached_county = await _get_cached_county(cache_key)
    if cached_county is not None:
        return cached_county

    try:
        response = await shared_async_client().get(
            MAPBOX_REVERSE_GEOCODE_URL,
            params={
                "longitude": lng,
                "latitude": lat,
                "access_token": token,
                "country": "US",
                "worldview": "us",
                "permanent": "true",
            },
            timeout=MAPBOX_REQUEST_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
    except httpx.HTTPError as exc:
        logger.warning(
            "Mapbox county lookup failed for lat=%s lng=%s: %s",
            lat,
            lng,
            exc,
        )
        return None

    county_name = _extract_county_name(response.json())
    if county_name:
        await _cache_county(
            cache_key,
            county_name,
            cache_settings.redis_ttl_county_seconds,
        )
    else:
        logger.warning(
            "Mapbox county lookup returned no county for lat=%s lng=%s",
            lat,
            lng,
        )
    return county_name


def _extract_county_name(payload: dict) -> str | None:
    for feature in payload.get("features", []):
        county_name = _county_name_from_feature(feature)
        if county_name:
            return county_name
    return None


def _county_name_from_feature(feature: dict) -> str | None:
    properties = feature.get("properties") or {}
    context = properties.get("context") or {}

    district = context.get("district")
    if isinstance(district, dict):
        district_name = district.get("name")
        if isinstance(district_name, str) and district_name.strip():
            return district_name.strip()

    feature_name = properties.get("name")
    feature_type = properties.get("feature_type")
    if (
        feature_type == "district"
        and isinstance(feature_name, str)
        and feature_name.strip()
    ):
        return feature_name.strip()

    return None


def _build_county_cache_key(prefix: str, lat: float, lng: float) -> str:
    return build_cache_key(
        prefix,
        "county",
        rounded_lat_lng_id(lat, lng, decimals=COUNTY_CACHE_COORDINATE_DECIMALS),
    )


async def _get_cached_county(cache_key: str) -> str | None:
    try:
        cached_payload = await get_cache().get_json(cache_key, resource="county")
    except Exception as exc:
        logger.warning("County cache lookup failed cleanly: %s", exc)
        return None

    if not cached_payload:
        return None

    cached_county = cached_payload.get("county")
    if isinstance(cached_county, str) and cached_county.strip():
        return cached_county.strip()
    return None


async def _cache_county(
    cache_key: str,
    county_name: str,
    ttl_seconds: int,
) -> None:
    try:
        await get_cache().set_json(
            cache_key,
            {"county": county_name},
            ttl_seconds=ttl_seconds,
            resource="county",
        )
    except Exception as exc:
        logger.warning("County cache write failed cleanly: %s", exc)


def _env_search_paths() -> tuple[Path, Path, Path]:
    repo_root = Path(__file__).resolve().parents[1]
    return (
        repo_root / ".env",
        repo_root.parent / "ADYou2-Frontend" / ".env",
        repo_root.parent / "ADYou2-Frontend" / ".env.local",
    )


def _read_env_value(env_path: Path, env_names: tuple[str, ...]) -> str:
    if not env_path.exists():
        return ""

    try:
        for raw_line in env_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue

            key, value = line.split("=", 1)
            if key.strip() in env_names:
                cleaned_value = value.strip().strip("\"'")
                if cleaned_value:
                    return cleaned_value
    except OSError as exc:
        logger.warning("Failed to read env file %s: %s", env_path, exc)

    return ""
