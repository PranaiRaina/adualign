"""Helpers for stable map-cache keys."""

import hashlib
import json
from typing import Any

MAP_CACHE_VERSION = "v1"
DEFAULT_COORDINATE_DECIMALS = 5
DEFAULT_GEOMETRY_DECIMALS = 6


def build_cache_key(prefix: str, resource: str, stable_id: str) -> str:
    """Build a namespaced cache key for map-related resources."""
    return f"{prefix}:{MAP_CACHE_VERSION}:map:{resource}:{stable_id}"


def rounded_lat_lng_id(
    lat: float,
    lng: float,
    *,
    decimals: int = DEFAULT_COORDINATE_DECIMALS,
) -> str:
    """Normalize point lookups so tiny float noise does not explode key count."""
    return f"{round(lat, decimals):.{decimals}f}:{round(lng, decimals):.{decimals}f}"


def round_nested_numbers(
    value: Any,
    *,
    decimals: int = DEFAULT_GEOMETRY_DECIMALS,
) -> Any:
    if isinstance(value, float):
        return round(value, decimals)
    if isinstance(value, list):
        return [round_nested_numbers(item, decimals=decimals) for item in value]
    if isinstance(value, dict):
        return {
            key: round_nested_numbers(item, decimals=decimals)
            for key, item in value.items()
        }
    return value


def normalize_geojson_geometry(
    geometry: dict[str, Any],
    *,
    decimals: int = DEFAULT_GEOMETRY_DECIMALS,
) -> dict[str, Any]:
    """Round nested GeoJSON coordinates into a stable comparison shape."""
    return round_nested_numbers(geometry, decimals=decimals)


def normalize_geojson_list(
    geometries: list[dict[str, Any]],
    *,
    decimals: int = DEFAULT_GEOMETRY_DECIMALS,
) -> list[str]:
    """Return order-insensitive serialized geometries for cache keys."""
    return sorted(
        json.dumps(
            normalize_geojson_geometry(geometry, decimals=decimals),
            sort_keys=True,
            separators=(",", ":"),
        )
        for geometry in geometries
    )


def build_recompute_request_id(
    *,
    property_geojson: dict[str, Any],
    setback_ft: float,
    adu_type: str,
    active_buildings: list[dict[str, Any]],
    primary_structure_geojson: dict[str, Any] | None,
    decimals: int = DEFAULT_GEOMETRY_DECIMALS,
) -> str:
    """Hash the normalized recompute inputs into a short stable identifier."""
    normalized_property = normalize_geojson_geometry(
        property_geojson, decimals=decimals
    )
    normalized_active_buildings = normalize_geojson_list(
        active_buildings,
        decimals=decimals,
    )
    normalized_primary = (
        normalize_geojson_geometry(primary_structure_geojson, decimals=decimals)
        if primary_structure_geojson is not None and adu_type == "attached"
        else None
    )
    payload = {
        "property_geojson": normalized_property,
        "setback_ft": round(setback_ft, decimals),
        "adu_type": adu_type,
        "active_buildings": normalized_active_buildings,
        "primary_structure_geojson": normalized_primary,
    }
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()
