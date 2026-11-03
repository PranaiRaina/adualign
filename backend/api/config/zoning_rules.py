"""
Location-based ADU zoning regulations.

Each location is a dictionary of rules that the validation engine consumes.
To add a new city/county, simply add a new key to ZONING_RULES with the
appropriate constraints. The API request specifies `location` (e.g. "irvine_ca")
and the engine pulls the matching ruleset.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class ZoningRule:
    """Immutable container for a single location's ADU zoning constraints."""

    location_name: str
    max_sqft_detached: float
    max_sqft_junior: float
    min_sqft: float
    setback_side_ft: float
    setback_rear_ft: float
    setback_front_ft: float
    max_height_ft: float
    max_lot_coverage_pct: float  # max % of lot the ADU can cover
    notes: str = ""


# ---------------------------------------------------------------------------
# Registry – add new locations here
# ---------------------------------------------------------------------------

ZONING_RULES: dict[str, ZoningRule] = {
    "irvine_ca": ZoningRule(
        location_name="Irvine, CA",
        max_sqft_detached=1200.0,
        max_sqft_junior=500.0,
        min_sqft=150.0,
        setback_side_ft=4.0,
        setback_rear_ft=4.0,
        setback_front_ft=4.0,
        max_height_ft=16.0,
        max_lot_coverage_pct=50.0,
        notes=(
            "One detached ADU (up to 1,200 sq ft) and one Junior ADU "
            "(up to 500 sq ft) per single-family lot. Attached units "
            "allowed up to 50% of primary dwelling. No owner-occupancy "
            "required through 2024. Pre-approved plans available."
        ),
    ),
}


def get_zoning_rule(location: str) -> ZoningRule:
    """Return the ZoningRule for *location*, or raise ValueError."""
    rule = ZONING_RULES.get(location)
    if rule is None:
        supported = ", ".join(sorted(ZONING_RULES.keys()))
        raise ValueError(
            f"Unknown location '{location}'. Supported locations: {supported}"
        )
    return rule
