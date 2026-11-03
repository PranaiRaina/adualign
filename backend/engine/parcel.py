"""
ReportAll API integration for fetching parcel boundaries by coordinates.

Uses the ReportAll USA Parcel API to retrieve the parcel polygon (in WKT)
that contains the given latitude/longitude point, and converts it to a
Shapely geometry for downstream analysis.
"""

import hashlib
import logging
import os
from dataclasses import dataclass
from typing import Any, cast
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import httpx
from dotenv import dotenv_values, load_dotenv
from shapely import wkt
from shapely.geometry import Polygon, MultiPolygon

from api.cache.keys import build_cache_key, rounded_lat_lng_id
from api.cache.redis_cache import get_cache
from api.config.cache_settings import get_cache_settings
from api.http_client import shared_async_client
from engine.geometry import calculate_area_sqft, min_rotated_rect_dims_ft


logger = logging.getLogger(__name__)

load_dotenv()
REPORTALL_API_KEY = os.getenv("REPORTALL_API_KEY", "")

REPORTALL_BASE_URL = "https://reportallusa.com/api/parcels.php"
REPORTALL_API_VERSION = 9
PARCEL_CACHE_COORDINATE_DECIMALS = 5
MIN_BUILDING_OVERLAP_RATIO = 0.8


class ParcelServiceError(Exception):
    """ReportAll could not be queried (network, HTTP, or API-level failure)."""


@dataclass
class ParcelData:
    """Parsed parcel information from ReportAll."""

    polygon: Polygon | MultiPolygon  # WGS-84 geometry
    apn: str | None = None
    acreage: float | None = None
    owner: str | None = None
    address: str | None = None
    # Assessor living area (ReportAll bldg_sqft); None when absent or untrusted
    home_sqft: float | None = None

    # Enhanced via Mapbox Building Footprints
    primary_structure_sqft: float | None = None
    primary_structure_dimensions: str | None = None
    secondary_structures_sqft: list[float] | None = None
    valid_building_geoms: list[Polygon | MultiPolygon] | None = (
        None  # WGS-84 geometries for frontend rendering
    )

    raw: dict | None = None  # Full API response for debugging


async def fetch_parcel_by_coords(
    lat: float,
    lng: float,
    building_footprints: list[Polygon | MultiPolygon] | None = None,
) -> ParcelData | None:
    """
    Fetch the parcel polygon that contains the given lat/lng point.

    Returns:
        ParcelData with the Shapely polygon and metadata, or None if not found.

    Raises:
        ParcelServiceError: if ReportAll is unreachable or returns an error.
    """
    reportall_api_key = _get_reportall_api_key()
    if not reportall_api_key:
        raise ValueError("REPORTALL_API_KEY is not set in .env")
    cache_settings = get_cache_settings()
    cache_key = _build_parcel_cache_key(
        cache_settings.redis_prefix,
        lat,
        lng,
    )
    cached_parcel_base = await _get_cached_parcel_base(cache_key)
    if cached_parcel_base is not None:
        return _parcel_data_from_base(cached_parcel_base, building_footprints)

    logger.info(
        "Fetching parcel from ReportAll: lat=%s, lng=%s, client_fingerprint=%s",
        lat,
        lng,
        _credential_fingerprint(reportall_api_key),
    )

    try:
        resp = await shared_async_client().get(
            REPORTALL_BASE_URL,
            params=_build_reportall_params(lat, lng, reportall_api_key),
            timeout=15.0,
        )
        resp.raise_for_status()
    except httpx.RequestError as e:
        logger.error(f"ReportAll API request failed: {e}")
        raise ParcelServiceError("ReportAll request failed") from e
    except httpx.HTTPStatusError as e:
        response_text = e.response.text if e.response is not None else ""
        status_code = e.response.status_code if e.response is not None else "unknown"
        request_url = _redact_reportall_client(str(e.request.url))
        logger.error(
            "ReportAll API HTTP error: status=%s url=%s. Response body: %s",
            status_code,
            request_url,
            response_text,
        )
        raise ParcelServiceError(f"ReportAll HTTP {status_code}") from e

    data = resp.json()

    # Never log the payload: ReportAll echoes the request query, including the
    # API key, back in its response.
    if data.get("status") != "OK":
        logger.error("ReportAll API error: status=%s", data.get("status"))
        raise ParcelServiceError(f"ReportAll status {data.get('status')}")
    if not data.get("results"):
        logger.warning("ReportAll returned no parcel: count=%s", data.get("count"))
        return None

    # Parcel data is intentionally eventually consistent within the configured TTL.
    parcel_base = _parcel_base_from_api_result(data["results"][0])
    if parcel_base is None:
        return None
    await _cache_parcel_base(
        cache_key,
        parcel_base,
        cache_settings.redis_ttl_parcel_seconds,
    )
    return _parcel_data_from_base(parcel_base, building_footprints)


def _safe_float(value) -> float | None:
    """Safely convert a value to float, returning None on failure."""
    if value is None:
        return None
    try:
        return float(value)
    except (ValueError, TypeError):
        return None


def _normalize_parcel_geometry(
    geometry: Polygon | MultiPolygon,
) -> Polygon | MultiPolygon:
    """Repair ReportAll geometry into a single valid polygonal shape."""
    if isinstance(geometry, MultiPolygon):
        geometry = max(geometry.geoms, key=lambda g: g.area)

    if not geometry.is_valid:
        buffer_geom = geometry.buffer(0)
        if isinstance(buffer_geom, (Polygon, MultiPolygon)):
            return buffer_geom
        raise ValueError("Buffer did not return a valid Polygon")
    return geometry


def _parcel_base_from_api_result(parcel: dict[str, Any]) -> dict[str, Any] | None:
    """Extract the cacheable parcel fields from a ReportAll API result."""
    geom_wkt = parcel.get("geom_as_wkt")
    if not geom_wkt:
        logger.warning("ReportAll parcel has no geometry (geom_as_wkt missing)")
        return None
    try:
        geometry = wkt.loads(geom_wkt)
    except Exception as e:
        logger.error(f"Failed to parse WKT geometry: {e}")
        return None
    if not isinstance(geometry, (Polygon, MultiPolygon)):
        logger.error(
            "ReportAll parcel geometry was not polygonal: %s", type(geometry).__name__
        )
        return None

    try:
        geometry = _normalize_parcel_geometry(cast(Polygon | MultiPolygon, geometry))
    except ValueError as e:
        logger.error(f"Invalid parcel geometry after buffering: {e}")
        return None

    logger.info(
        f"ReportAll parcel found: APN={parcel.get('apn')}, "
        f"acreage={parcel.get('calculated_acreage')}, "
        f"geometry type={geometry.geom_type}"
    )
    bldg_sqft = _safe_float(parcel.get("bldg_sqft"))
    buildings = _safe_float(parcel.get("buildings"))
    return {
        "polygon": geometry,
        "apn": parcel.get("apn") or parcel.get("parcel_id"),
        "acreage": _safe_float(
            parcel.get("acreage_calc") or parcel.get("calculated_acreage")
        ),
        "owner": parcel.get("owner"),
        "address": parcel.get("site_address") or parcel.get("address"),
        # Trust bldg_sqft as the primary home's living area only when the
        # assessor reports a single structure; multi-building parcels may sum
        # structures, which would understate the attached-ADU 50% warning.
        "home_sqft": (
            bldg_sqft
            if bldg_sqft is not None and bldg_sqft > 0 and buildings in (None, 1)
            else None
        ),
        "raw": parcel,
    }


def _parcel_base_to_cache(parcel_base: dict[str, Any]) -> dict[str, Any]:
    """Convert parcel metadata into a compact Redis-safe JSON payload."""
    geometry = parcel_base["polygon"]
    return {
        "polygon_wkt": geometry.wkt,
        "apn": parcel_base["apn"],
        "acreage": parcel_base["acreage"],
        "owner": parcel_base["owner"],
        "address": parcel_base["address"],
        "home_sqft": parcel_base["home_sqft"],
    }


def _parcel_base_from_cache(cached_payload: dict[str, Any]) -> dict[str, Any] | None:
    """Rebuild parcel metadata from the cached Redis payload."""
    geom_wkt = cached_payload.get("polygon_wkt")
    if not geom_wkt:
        return None
    try:
        parsed_geometry = wkt.loads(geom_wkt)
        if not isinstance(parsed_geometry, (Polygon, MultiPolygon)):
            return None
        geometry = _normalize_parcel_geometry(
            cast(Polygon | MultiPolygon, parsed_geometry)
        )
    except Exception as e:
        logger.warning(f"Failed to restore cached parcel geometry: {e}")
        return None
    return {
        "polygon": geometry,
        "apn": cached_payload.get("apn"),
        "acreage": cached_payload.get("acreage"),
        "owner": cached_payload.get("owner"),
        "address": cached_payload.get("address"),
        "home_sqft": cached_payload.get("home_sqft"),
        "raw": None,
    }


def _parcel_data_from_base(
    parcel_base: dict[str, Any],
    building_footprints: list[Polygon | MultiPolygon] | None,
) -> ParcelData:
    """Combine cached parcel metadata with the current building footprints."""
    geometry = parcel_base["polygon"]
    valid_buildings = _find_valid_buildings(geometry, building_footprints or [])
    primary_sqft, primary_dims, secondary_sqft = _measure_structures(valid_buildings)

    return ParcelData(
        polygon=geometry,
        apn=parcel_base["apn"],
        acreage=parcel_base["acreage"],
        owner=parcel_base["owner"],
        address=parcel_base["address"],
        home_sqft=parcel_base["home_sqft"],
        primary_structure_sqft=primary_sqft,
        primary_structure_dimensions=primary_dims,
        secondary_structures_sqft=secondary_sqft,
        valid_building_geoms=valid_buildings if valid_buildings else None,
        raw=parcel_base["raw"],
    )


def _find_valid_buildings(
    parcel_geometry: Polygon | MultiPolygon,
    building_footprints: list[Polygon | MultiPolygon],
) -> list[Polygon | MultiPolygon]:
    """Return parcel-contained buildings sorted from largest to smallest."""
    valid_buildings: list[Polygon | MultiPolygon] = []

    for building_geometry in building_footprints:
        try:
            if _is_building_inside_parcel(parcel_geometry, building_geometry):
                valid_buildings.append(building_geometry)
        except Exception as e:
            logger.warning(f"Error filtering building footprint: {e}")

    valid_buildings.sort(key=_largest_polygon_area_sqft, reverse=True)
    return valid_buildings


def _is_building_inside_parcel(
    parcel_geometry: Polygon | MultiPolygon,
    building_geometry: Polygon | MultiPolygon,
) -> bool:
    building_area_sqft = _largest_polygon_area_sqft(building_geometry)
    if building_area_sqft <= 0:
        return False

    intersection = parcel_geometry.intersection(building_geometry)
    intersection_area_sqft = _intersection_area_sqft(intersection)
    return intersection_area_sqft >= (building_area_sqft * MIN_BUILDING_OVERLAP_RATIO)


def _intersection_area_sqft(intersection_geometry) -> float:
    if intersection_geometry.is_empty:
        return 0.0
    if not isinstance(intersection_geometry, (Polygon, MultiPolygon)):
        return 0.0
    return _largest_polygon_area_sqft(intersection_geometry)


def _largest_polygon_area_sqft(geometry: Polygon | MultiPolygon) -> float:
    return calculate_area_sqft(_largest_polygon(geometry))


def _largest_polygon(geometry: Polygon | MultiPolygon) -> Polygon:
    if isinstance(geometry, Polygon):
        return geometry
    return max(geometry.geoms, key=lambda polygon: polygon.area)


def _measure_structures(
    valid_buildings: list[Polygon | MultiPolygon],
) -> tuple[float | None, str | None, list[float]]:
    if not valid_buildings:
        return None, None, []

    primary_geometry = _largest_polygon(valid_buildings[0])
    primary_sqft = round(calculate_area_sqft(primary_geometry), 1)
    primary_dimensions = _format_structure_dimensions(primary_geometry)

    secondary_sqft = [
        round(_largest_polygon_area_sqft(building_geometry), 1)
        for building_geometry in valid_buildings[1:]
    ]
    return primary_sqft, primary_dimensions, secondary_sqft


def _format_structure_dimensions(
    primary_geometry: Polygon,
) -> str | None:
    try:
        dimensions = min_rotated_rect_dims_ft(primary_geometry)
    except Exception as e:
        logger.debug(f"Could not calculate building dimensions: {e}")
        return None

    if dimensions is None:
        return None
    return f"{round(dimensions[0])}x{round(dimensions[1])}"


def _build_parcel_cache_key(prefix: str, lat: float, lng: float) -> str:
    # v2: payload gained home_sqft; orphans pre-home_sqft entries (30d TTL)
    return build_cache_key(
        prefix,
        "parcel_v2",
        rounded_lat_lng_id(lat, lng, decimals=PARCEL_CACHE_COORDINATE_DECIMALS),
    )


def _get_reportall_api_key() -> str:
    dotenv_value = dotenv_values(".env").get("REPORTALL_API_KEY")
    if dotenv_value:
        return str(dotenv_value).strip()
    env_value = os.getenv("REPORTALL_API_KEY")
    return str(env_value or "").strip()


def _credential_fingerprint(value: str) -> str:
    """Return an opaque, stable identifier for a credential without exposing it.

    Uses a truncated SHA-256 digest so the same key produces the same
    fingerprint across log lines (useful for spotting key rotations) while
    leaking no recoverable part of the secret itself.
    """
    if not value:
        return "empty"
    digest = hashlib.sha256(value.encode("utf-8")).hexdigest()
    return f"sha256:{digest[:12]}"


def _build_reportall_params(
    lat: float,
    lng: float,
    reportall_api_key: str | None = None,
) -> dict[str, Any]:
    return {
        "client": reportall_api_key or _get_reportall_api_key(),
        "spatial_intersect": f"POINT({lng} {lat})",
        "si_srid": 4326,
        "rpp": 1,
        "v": REPORTALL_API_VERSION,
    }


def _redact_reportall_client(url: str) -> str:
    parts = urlsplit(url)
    query = urlencode(
        [
            (key, "[REDACTED]" if key.lower() in {"client", "token"} else value)
            for key, value in parse_qsl(parts.query, keep_blank_values=True)
        ]
    )
    return urlunsplit((parts.scheme, parts.netloc, parts.path, query, parts.fragment))


async def _get_cached_parcel_base(cache_key: str) -> dict[str, Any] | None:
    try:
        cached_payload = await get_cache().get_json(cache_key, resource="parcel")
    except Exception as e:
        logger.warning(f"Parcel cache lookup failed cleanly: {e}")
        return None
    if cached_payload is None:
        return None
    return _parcel_base_from_cache(cached_payload)


async def _cache_parcel_base(
    cache_key: str,
    parcel_base: dict[str, Any],
    ttl_seconds: int,
) -> None:
    try:
        await get_cache().set_json(
            cache_key,
            _parcel_base_to_cache(parcel_base),
            ttl_seconds=ttl_seconds,
            resource="parcel",
        )
    except Exception as e:
        logger.warning(f"Parcel cache write failed cleanly: {e}")
