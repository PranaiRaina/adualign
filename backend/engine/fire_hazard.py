"""
CAL FIRE Fire Hazard Severity Zone (FHSZ) lookup.

Queries the official CAL FIRE ArcGIS REST API for a given lat/lng point.
Checks the SRA layer first; falls back to the LRA layer if no result found.
Never raises — always returns a FireHazardResult (with severity="None" on failure).
"""

import json
import logging
from dataclasses import dataclass

import httpx

from api.cache.keys import build_cache_key, rounded_lat_lng_id
from api.cache.redis_cache import get_cache
from api.config.cache_settings import get_cache_settings

logger = logging.getLogger(__name__)
FIRE_HAZARD_CACHE_COORDINATE_DECIMALS = 5
FIRE_HAZARD_REQUEST_TIMEOUT_SECONDS = 4.0

_LAYERS = [
    (
        "SRA",
        "https://services1.arcgis.com/9z9tEfqo0TExR9C8/arcgis/rest/services/CALFIRE_Fire_Hazard_Severity_Zones_2024/FeatureServer/0/query",
    ),
    (
        "LRA",
        "https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/arcgis/rest/services/FHSALRA25_v1_All/FeatureServer/0/query",
    ),
]

# Maps raw FHSZ_Descr / FHSZ_Description field values → canonical severity string
_FHSZ_DESCR_MAP: dict[str, str] = {
    "Moderate": "Moderate",
    "High": "High",
    "Very High": "Very High",
    "MODERATE": "Moderate",
    "HIGH": "High",
    "VERY HIGH": "Very High",
    "NonWildland": "None",
    "Non-Wildland": "None",
    "LRA Unzoned": "None",
    "Urban Unzoned": "None",
}
# Numeric FHSZ code fallback (1=Moderate, 2=High, 3=Very High)
_FHSZ_CODE_MAP: dict[int, str] = {1: "Moderate", 2: "High", 3: "Very High"}
MAX_LAYER_ATTEMPTS = 2


@dataclass
class FireHazardResult:
    """Result of a FHSZ lookup for a given coordinate."""

    severity: str  # "None" | "Moderate" | "High" | "Very High"
    zone_type: str  # "SRA" | "LRA" | "None"
    source_layer: str  # human-readable label for debugging


async def check_fire_hazard(lat: float, lng: float) -> FireHazardResult:
    """
    Query CAL FIRE FHSZ layers for the given coordinate.

    Tries SRA (State Responsibility Area) first, then LRA (Local Responsibility Area).
    Returns severity="None" / zone_type="None" if the point falls outside all zones.
    Returns severity="Unknown" / zone_type="Unknown" if all layers fail to respond.
    """
    import asyncio

    cache_settings = get_cache_settings()
    cache_key = _build_fire_hazard_cache_key(
        cache_settings.redis_prefix,
        lat,
        lng,
    )
    cached_result = await _get_cached_fire_hazard_result(cache_key)
    if cached_result is not None:
        return cached_result

    succeeded_at_least_once = False

    async with httpx.AsyncClient(timeout=FIRE_HAZARD_REQUEST_TIMEOUT_SECONDS) as client:
        for zone_type, url in _LAYERS:
            for attempt in range(MAX_LAYER_ATTEMPTS):
                try:
                    resp = await client.get(
                        url,
                        params=_build_fire_hazard_params(lat, lng),
                    )
                    resp.raise_for_status()
                    data = resp.json()

                    # Reached here without throwing, so the query succeeded
                    succeeded_at_least_once = True

                    attributes = _first_feature_attributes(data)
                    if attributes is None:
                        # No result in this layer — try the next one
                        logger.info(
                            f"FHSZ: No result in {zone_type} layer for ({lat}, {lng})"
                        )
                        break

                    descr, severity = _resolve_severity(attributes)

                    if severity == "None":
                        # Point is inside the zone dataset but explicitly marked as safe
                        logger.info(
                            f"FHSZ hit safe zone in {zone_type}: descr={descr!r}"
                        )
                        result = FireHazardResult(
                            severity="None", zone_type="None", source_layer=url
                        )
                        await _cache_fire_hazard_result(
                            cache_key,
                            result,
                            cache_settings.redis_ttl_fire_hazard_seconds,
                        )
                        return result

                    if not severity:
                        severity = "Moderate"  # Unknown zone still in the dataset → assume moderate

                    logger.info(
                        f"FHSZ hit in {zone_type}: FHSZ_Descr={descr!r}, severity={severity}"
                    )
                    result = FireHazardResult(
                        severity=severity,
                        zone_type=zone_type,
                        source_layer=url,
                    )
                    await _cache_fire_hazard_result(
                        cache_key,
                        result,
                        cache_settings.redis_ttl_fire_hazard_seconds,
                    )
                    return result

                except httpx.TimeoutException:
                    logger.warning(
                        f"FHSZ {zone_type} layer timed out for ({lat}, {lng}) on attempt {attempt + 1}"
                    )
                    if attempt < (MAX_LAYER_ATTEMPTS - 1):
                        await asyncio.sleep(0.5)
                except httpx.HTTPError as e:
                    logger.warning(
                        f"FHSZ {zone_type} layer HTTP error: {e} on attempt {attempt + 1}"
                    )
                    if attempt < (MAX_LAYER_ATTEMPTS - 1):
                        await asyncio.sleep(0.5)
                except Exception as e:
                    logger.warning(f"FHSZ {zone_type} layer error: {e}")
                    break  # Break out of retry loop for non-network errors

    if succeeded_at_least_once:
        # We successfully talked to the server and it returned no features
        result = FireHazardResult(severity="None", zone_type="None", source_layer="")
        # Fire hazard lookups are eventually consistent within the configured TTL.
        await _cache_fire_hazard_result(
            cache_key,
            result,
            cache_settings.redis_ttl_fire_hazard_seconds,
        )
        return result
    else:
        # All layers completely failed (timeout / HTTP error)
        return FireHazardResult(
            severity="Unknown", zone_type="Unknown", source_layer=""
        )


def _fire_hazard_result_from_cache(
    payload: dict[str, str],
) -> FireHazardResult | None:
    severity = payload.get("severity")
    zone_type = payload.get("zone_type")
    source_layer = payload.get("source_layer")
    if severity is None or zone_type is None or source_layer is None:
        return None
    return FireHazardResult(
        severity=severity,
        zone_type=zone_type,
        source_layer=source_layer,
    )


async def _cache_fire_hazard_result(
    cache_key: str,
    result: FireHazardResult,
    ttl_seconds: int,
) -> None:
    if result.severity == "Unknown":
        return
    try:
        await get_cache().set_json(
            cache_key,
            {
                "severity": result.severity,
                "zone_type": result.zone_type,
                "source_layer": result.source_layer,
            },
            ttl_seconds=ttl_seconds,
            resource="fire_hazard",
        )
    except Exception as e:
        logger.warning(f"Fire hazard cache write failed cleanly: {e}")


def _build_fire_hazard_cache_key(prefix: str, lat: float, lng: float) -> str:
    return build_cache_key(
        prefix,
        "fire_hazard",
        rounded_lat_lng_id(lat, lng, decimals=FIRE_HAZARD_CACHE_COORDINATE_DECIMALS),
    )


def _build_fire_hazard_params(lat: float, lng: float) -> dict[str, str]:
    return {
        "where": "1=1",
        "geometry": json.dumps(
            {"x": lng, "y": lat, "spatialReference": {"wkid": 4326}}
        ),
        "geometryType": "esriGeometryPoint",
        "inSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": "*",
        "returnGeometry": "false",
        "f": "json",
    }


async def _get_cached_fire_hazard_result(
    cache_key: str,
) -> FireHazardResult | None:
    try:
        cached_payload = await get_cache().get_json(
            cache_key,
            resource="fire_hazard",
        )
    except Exception as e:
        logger.warning(f"Fire hazard cache lookup failed cleanly: {e}")
        return None
    if cached_payload is None:
        return None
    return _fire_hazard_result_from_cache(cached_payload)


def _first_feature_attributes(data: dict) -> dict | None:
    features = data.get("features", [])
    if not features:
        return None
    return features[0].get("attributes", {})


def _resolve_severity(attributes: dict) -> tuple[str, str | None]:
    raw_description = (
        attributes.get("FHSZ_Description") or attributes.get("FHSZ_Descr") or ""
    )
    description = str(raw_description).strip()
    severity = _FHSZ_DESCR_MAP.get(description)
    if severity is not None:
        return description, severity

    code = attributes.get("FHSZ")
    if isinstance(code, int):
        if code < 0:
            return description, "None"
        return description, _FHSZ_CODE_MAP.get(code)

    return description, None
