"""Shared property-context models and formatting helpers."""

from __future__ import annotations

import re
from typing import Any, Iterable

from pydantic import BaseModel

PARCEL_BOUNDARY_TARGET_KIND = "parcel-boundary"
ACTIVE_STRUCTURE_TARGET_KIND = "active-structure"
FIRE_BUILDING_SEPARATION_FT = 6.0

CLEARANCE_DIRECTION_ORDER = {
    "top": 0,
    "right": 1,
    "bottom": 2,
    "left": 3,
}

NON_RECTANGULAR_ADU_SHAPES = frozenset(
    {
        "l-shape",
        "l_shape",
        "t-shape",
        "t_shape",
        "u-shape",
        "u_shape",
    }
)

FOOTPRINT_CONTEXT_MARKERS = (
    "adu dimensions",
    "overall footprint",
    "overall footprint*",
    "footprint dimensions",
)

FOOTPRINT_DIMENSIONS_RE = re.compile(
    r"\d+(?:\.\d+)?\s*x\s*\d+(?:\.\d+)?\s*ft",
    re.IGNORECASE,
)


class AduClearance(BaseModel):
    direction: str
    target_kind: str
    distance_feet: float
    target_structure_index: int | None = None


def normalize_adu_shape(value: Any) -> str:
    return str(value or "").strip().lower().replace("_", "-")


def is_non_rectangular_adu_shape(value: Any) -> bool:
    normalized = normalize_adu_shape(value)
    return normalized in {"l-shape", "t-shape", "u-shape"}


def is_non_rectangular_adu(project: Any) -> bool:
    return is_non_rectangular_adu_shape(getattr(project, "adu_shape", None))


def format_adu_dimensions(width_ft: Any, length_ft: Any) -> str | None:
    if width_ft is None or length_ft is None:
        return None
    return f"{float(width_ft):.1f} x {float(length_ft):.1f} ft"


def get_project_adu_dimensions(project: Any) -> tuple[float | None, float | None]:
    width = getattr(project, "adu_width_ft", None)
    length = getattr(project, "adu_length_ft", None)
    if width is None or length is None:
        return None, None
    return float(width), float(length)


def footprint_dimensions_label_for_shape(adu_shape: Any) -> str:
    if is_non_rectangular_adu_shape(adu_shape):
        return "ADU Overall Footprint Dimensions"
    return "ADU Footprint Dimensions"


def footprint_dimensions_label(project: Any) -> str:
    return footprint_dimensions_label_for_shape(getattr(project, "adu_shape", None))


def footprint_mentioned_in_text(text: str) -> bool:
    lowered = text.lower()
    if any(marker in lowered for marker in FOOTPRINT_CONTEXT_MARKERS):
        return True
    return bool(FOOTPRINT_DIMENSIONS_RE.search(lowered))


def format_adu_footprint_bullet(project: Any) -> str:
    width, length = get_project_adu_dimensions(project)
    if width is None or length is None:
        return ""
    label = footprint_dimensions_label(project)
    return f"- {label}: {width:g} x {length:g} ft"


def build_property_footprint_supplement(project: Any) -> str:
    bullet = format_adu_footprint_bullet(project)
    if not bullet:
        return ""

    lines = ["### Property footprint (saved project data)", bullet]
    adu_shape = getattr(project, "adu_shape", None)
    if is_non_rectangular_adu_shape(adu_shape):
        shape_label = str(adu_shape).replace("_", " ").replace("-", " ").title()
        lines.append(
            "- ADU Footprint Note: dimensions are the outer bounding box; "
            f"leg details for the {shape_label} shape remain in the saved map."
        )
    return "\n".join(lines)


def normalize_adu_clearances(
    clearances: Iterable[AduClearance | dict[str, Any]] | None,
) -> list[AduClearance]:
    if not clearances:
        return []
    return [
        clearance
        if isinstance(clearance, AduClearance)
        else AduClearance.model_validate(clearance)
        for clearance in clearances
    ]


def format_adu_clearances(
    clearances: Iterable[AduClearance | dict[str, Any]] | None,
) -> str | None:
    normalized_clearances = normalize_adu_clearances(clearances)
    if not normalized_clearances:
        return None
    return "; ".join(
        format_single_adu_clearance(clearance) for clearance in normalized_clearances
    )


def format_single_adu_clearance(clearance: AduClearance) -> str:
    return (
        f"{clearance.direction}: {clearance.distance_feet:.1f} ft "
        f"to {describe_clearance_target(clearance)}"
    )


def describe_clearance_target(clearance: AduClearance) -> str:
    if clearance.target_kind == PARCEL_BOUNDARY_TARGET_KIND:
        return "property line"
    if clearance.target_structure_index is None:
        return "existing structure"
    return f"structure #{clearance.target_structure_index}"


def describe_zoning_clearance_target(clearance: AduClearance) -> str:
    if clearance.target_kind == PARCEL_BOUNDARY_TARGET_KIND:
        return "parcel"
    if clearance.target_structure_index is None:
        return "Structure"
    return f"Structure #{clearance.target_structure_index}"


def format_zoning_clearance_phrase(clearance: AduClearance) -> str:
    direction = str(clearance.direction or "").strip().title() or "Side"
    distance = f"{clearance.distance_feet:.1f} ft"
    target = describe_zoning_clearance_target(clearance)
    return f"{direction} {distance} to {target}"


def format_zoning_placement_clearances(
    clearances: Iterable[AduClearance | dict[str, Any]] | None,
) -> str | None:
    normalized_clearances = normalize_adu_clearances(clearances)
    if not normalized_clearances:
        return None

    ordered = sorted(
        normalized_clearances,
        key=lambda clearance: CLEARANCE_DIRECTION_ORDER.get(
            str(clearance.direction or "").strip().lower(),
            99,
        ),
    )
    return " · ".join(
        format_zoning_clearance_phrase(clearance) for clearance in ordered
    )


def clearance_meets_zoning_minimums(
    clearance: AduClearance,
    *,
    parcel_setback_ft: float | None,
) -> bool:
    if clearance.target_kind == PARCEL_BOUNDARY_TARGET_KIND:
        if parcel_setback_ft is None:
            return True
        return clearance.distance_feet >= parcel_setback_ft
    return clearance.distance_feet >= FIRE_BUILDING_SEPARATION_FT
