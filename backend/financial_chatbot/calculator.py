"""Deterministic finance state helpers for the ADU cost calculator."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

from .schemas import (
    BaseEstimateInputs,
    EstimateRange,
    FinanceComplicationFlags,
    FinanceComplicationOption,
    FinanceComplicationSummary,
    FinancePresentationInput,
    FinanceStateSnapshot,
    ManualComplicationSelections,
)

COMPLICATION_KEYS = (
    "slope",
    "demolition",
    "electric_panel",
    "septic_tank",
    "solar_mandate",
    "fire_resilient_upgrades",
    "very_high_fire_risk",
    "contingency",
    "hoa_restrictions",
)
AUTOMATIC_COMPLICATION_KEYS = (
    "solar_mandate",
    "fire_resilient_upgrades",
    "very_high_fire_risk",
    "contingency",
)
MANUAL_COMPLICATION_KEYS = tuple(
    key for key in COMPLICATION_KEYS if key not in AUTOMATIC_COMPLICATION_KEYS
)
UNKNOWN_FIRE_HAZARD_SEVERITY = "Unknown"
FIRE_RESILIENT_UPGRADE_SEVERITIES = frozenset(
    {UNKNOWN_FIRE_HAZARD_SEVERITY, "Moderate", "High"}
)
VERY_HIGH_FIRE_RISK_SEVERITIES = frozenset({"Very High"})
DETACHED_ADU_TYPE = "detached"
ATTACHED_ADU_TYPE = "attached"
DETACHED_PRICING_KEY = "detached_pricing"
ATTACHED_PRICING_KEY = "attached_pricing"
DEFAULT_COUNTY_MULTIPLIER = 1.0
BASE_ESTIMATE_LOW_FACTOR = 0.8
BASE_ESTIMATE_HIGH_FACTOR = 1.2
CURRENCY_DECIMALS = 2


@lru_cache(maxsize=1)
def load_cost_model() -> dict:
    data_path = Path(__file__).resolve().parent / "data" / "cost_model.json"
    with data_path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def hydrate_finance_state(
    stored_state: dict | FinanceStateSnapshot | None,
    *,
    address: str | None,
    county: str | None,
    adu_sqft: float | None,
    adu_type: str | None,
    fire_hazard_severity: str | None,
    fire_hazard_zone_type: str | None,
    adu_width_ft: float | None = None,
    adu_length_ft: float | None = None,
    adu_shape: str | None = None,
) -> FinanceStateSnapshot:
    if isinstance(stored_state, FinanceStateSnapshot):
        snapshot = stored_state
    elif stored_state:
        if isinstance(stored_state.get("complication_flags"), dict):
            complication_flags = dict(stored_state["complication_flags"])
            if (
                "high_fire_risk" in complication_flags
                and "very_high_fire_risk" not in complication_flags
            ):
                complication_flags["very_high_fire_risk"] = complication_flags.pop(
                    "high_fire_risk"
                )
            stored_state = {**stored_state, "complication_flags": complication_flags}
        snapshot = FinanceStateSnapshot.model_validate(stored_state)
    else:
        snapshot = FinanceStateSnapshot()

    if address:
        snapshot.address = address
    if county:
        snapshot.county = county
    if adu_sqft:
        snapshot.adu_sqft = adu_sqft
    if adu_width_ft:
        snapshot.adu_width_ft = adu_width_ft
    if adu_length_ft:
        snapshot.adu_length_ft = adu_length_ft
    if adu_type:
        snapshot.adu_type = adu_type
    if adu_shape:
        snapshot.adu_shape = adu_shape
    if fire_hazard_severity:
        snapshot.fire_hazard_severity = fire_hazard_severity
    if fire_hazard_zone_type:
        snapshot.fire_hazard_zone_type = fire_hazard_zone_type
    return snapshot


def bootstrap_base_estimate(snapshot: FinanceStateSnapshot) -> FinanceStateSnapshot:
    model = load_cost_model()
    base_estimate_inputs = build_base_estimate_inputs(snapshot, model)
    if base_estimate_inputs is None:
        synchronize_automatic_complications(snapshot)
        return snapshot
    if has_current_base_estimate(snapshot, base_estimate_inputs):
        synchronize_automatic_complications(snapshot)
        return snapshot

    base_estimate_value = calculate_base_estimate_value(snapshot, model)
    snapshot.base_estimate_value = base_estimate_value
    snapshot.base_estimate_range = build_estimate_range(base_estimate_value)
    snapshot.base_estimate_inputs = base_estimate_inputs
    synchronize_automatic_complications(snapshot)
    return snapshot


def build_base_estimate_inputs(
    snapshot: FinanceStateSnapshot,
    model: dict[str, Any],
) -> BaseEstimateInputs | None:
    if snapshot.adu_sqft is None:
        return None

    return BaseEstimateInputs(
        county=snapshot.county,
        adu_sqft=float(snapshot.adu_sqft),
        adu_type=snapshot.adu_type,
        pricing_version=int(model["pricing_version"]),
    )


def has_current_base_estimate(
    snapshot: FinanceStateSnapshot,
    current_inputs: BaseEstimateInputs,
) -> bool:
    return (
        snapshot.base_estimate_value is not None
        and snapshot.base_estimate_range is not None
        and snapshot.base_estimate_inputs == current_inputs
    )


def calculate_base_estimate_value(
    snapshot: FinanceStateSnapshot,
    model: dict[str, Any],
) -> float:
    pre_region_base_cost = calculate_pre_region_base_cost(snapshot, model)
    county_multiplier = get_county_multiplier(snapshot.county, model)
    return round_currency_amount(pre_region_base_cost * county_multiplier)


def calculate_pre_region_base_cost(
    snapshot: FinanceStateSnapshot,
    model: dict[str, Any],
) -> float:
    return calculate_tiered_pre_region_base_cost(
        adu_sqft=float(snapshot.adu_sqft or 0.0),
        pricing_config=model[get_pricing_key(snapshot.adu_type)],
    )


def get_pricing_key(adu_type: str | None) -> str:
    if adu_type == ATTACHED_ADU_TYPE:
        return ATTACHED_PRICING_KEY
    return DETACHED_PRICING_KEY


def calculate_tiered_pre_region_base_cost(
    *,
    adu_sqft: float,
    pricing_config: dict[str, Any],
) -> float:
    cost = 0.0
    band_start = 0.0
    for tier in pricing_config["tiers"]:
        band_end = float(tier["up_to_sqft"]) if "up_to_sqft" in tier else adu_sqft
        cost += max(min(adu_sqft, band_end) - band_start, 0.0) * float(
            tier["cost_per_sqft"]
        )
        band_start = band_end
    return max(cost, float(pricing_config["minimum_base_cost"]))


def get_county_multiplier(
    county: str | None,
    model: dict[str, Any],
) -> float:
    return float(
        model["county_multipliers"].get(county or "", DEFAULT_COUNTY_MULTIPLIER)
    )


def build_estimate_range(estimate_value: float) -> EstimateRange:
    return EstimateRange(
        low=round_currency_amount(estimate_value * BASE_ESTIMATE_LOW_FACTOR),
        high=round_currency_amount(estimate_value * BASE_ESTIMATE_HIGH_FACTOR),
    )


def round_currency_amount(amount: float) -> float:
    return round(float(amount), CURRENCY_DECIMALS)


def recompute_adjusted_estimate(snapshot: FinanceStateSnapshot) -> FinanceStateSnapshot:
    synchronize_automatic_complications(snapshot)
    active_keys = get_active_complications(snapshot.complication_flags)
    if snapshot.base_estimate_value is None or not active_keys:
        snapshot.complication_adjusted_value = None
        snapshot.complication_adjusted_range = None
        return snapshot

    subtotal = snapshot.base_estimate_value
    for complication_key in get_non_contingency_complications(active_keys):
        subtotal += calculate_complication_amount(complication_key, snapshot)

    total = subtotal
    if snapshot.complication_flags.contingency:
        total += calculate_complication_amount("contingency", snapshot)

    snapshot.complication_adjusted_value = float(total)
    snapshot.complication_adjusted_range = build_estimate_range(float(total))
    return snapshot


def synchronize_automatic_complications(snapshot: FinanceStateSnapshot) -> None:
    snapshot.complication_flags.solar_mandate = should_apply_solar_mandate(snapshot)
    snapshot.complication_flags.fire_resilient_upgrades = (
        should_apply_fire_resilient_upgrades(snapshot)
    )
    snapshot.complication_flags.very_high_fire_risk = should_apply_high_fire_risk(
        snapshot
    )
    snapshot.complication_flags.contingency = should_apply_contingency(snapshot)


def should_apply_solar_mandate(snapshot: FinanceStateSnapshot) -> bool:
    return (
        snapshot.adu_type == DETACHED_ADU_TYPE
        and snapshot.base_estimate_value is not None
    )


def should_apply_fire_resilient_upgrades(snapshot: FinanceStateSnapshot) -> bool:
    return (
        snapshot.fire_hazard_severity in FIRE_RESILIENT_UPGRADE_SEVERITIES
        and snapshot.base_estimate_value is not None
    )


def should_apply_high_fire_risk(snapshot: FinanceStateSnapshot) -> bool:
    return (
        snapshot.fire_hazard_severity in VERY_HIGH_FIRE_RISK_SEVERITIES
        and snapshot.base_estimate_value is not None
    )


def should_apply_contingency(snapshot: FinanceStateSnapshot) -> bool:
    return snapshot.base_estimate_value is not None


def get_non_contingency_complications(active_keys: list[str]) -> list[str]:
    return [key for key in active_keys if key != "contingency"]


def calculate_subtotal_before_contingency(snapshot: FinanceStateSnapshot) -> float:
    if snapshot.base_estimate_value is None:
        return 0.0
    subtotal = snapshot.base_estimate_value
    for complication_key in get_non_contingency_complications(
        get_active_complications(snapshot.complication_flags)
    ):
        subtotal += calculate_complication_amount(complication_key, snapshot)
    return subtotal


def calculate_complication_amount(
    complication_key: str,
    snapshot: FinanceStateSnapshot,
) -> float:
    model = load_cost_model()
    config = model["complications"][complication_key]
    kind: Literal[
        "percent_of_base", "fixed_amount", "per_sqft", "percent_of_subtotal"
    ] = config["kind"]

    if kind == "percent_of_base":
        return float((snapshot.base_estimate_value or 0.0) * config["percent"])
    if kind == "fixed_amount":
        return float(config["midpoint"])
    if kind == "per_sqft":
        return float((snapshot.adu_sqft or 0.0) * config["midpoint_per_sqft"])
    if kind == "percent_of_subtotal":
        return float(
            calculate_subtotal_before_contingency(snapshot) * config["percent"]
        )
    raise ValueError(f"Unsupported complication kind: {kind}")


def get_active_complications(flags: FinanceComplicationFlags) -> list[str]:
    return [key for key in COMPLICATION_KEYS if getattr(flags, key)]


def get_inactive_complications(flags: FinanceComplicationFlags) -> list[str]:
    return [key for key in COMPLICATION_KEYS if not getattr(flags, key)]


def get_complication_label(complication_key: str) -> str:
    return load_cost_model()["complications"][complication_key]["display_label"]


def apply_manual_complication_selections(
    snapshot: FinanceStateSnapshot,
    *,
    selections: ManualComplicationSelections | dict[str, bool] | None,
) -> FinanceStateSnapshot:
    if selections is None:
        return snapshot
    if isinstance(selections, ManualComplicationSelections):
        updates = selections.model_dump()
    else:
        updates = selections

    for complication_key in MANUAL_COMPLICATION_KEYS:
        if complication_key not in updates:
            continue
        setattr(
            snapshot.complication_flags,
            complication_key,
            bool(updates[complication_key]),
        )
    return snapshot


def format_currency(value: float) -> str:
    return f"${value:,.0f}"


def format_range(estimate_range: EstimateRange) -> str:
    return f"{format_currency(estimate_range.low)} - {format_currency(estimate_range.high)}"


def get_complication_model_range_text(complication_key: str) -> str:
    config = load_cost_model()["complications"][complication_key]
    display_range = config.get("display_range")
    if display_range:
        return display_range

    kind = config["kind"]
    if kind == "fixed_amount":
        return (
            f"{format_currency(float(config['low']))} - "
            f"{format_currency(float(config['high']))}"
        )
    if kind == "per_sqft":
        return (
            f"{format_currency(float(config['low_per_sqft']))} - "
            f"{format_currency(float(config['high_per_sqft']))} per sqft"
        )
    if kind == "percent_of_base":
        return f"Adds {int(config['percent'] * 100)}% to the base cost"
    return f"Adds {int(config['percent'] * 100)}% of the subtotal"


def build_modeled_complication_catalog(
    snapshot: FinanceStateSnapshot,
) -> list[dict[str, Any]]:
    active_keys = set(get_active_complications(snapshot.complication_flags))
    return [
        build_modeled_complication_entry(snapshot, complication_key, active_keys)
        for complication_key in COMPLICATION_KEYS
    ]


def build_modeled_complication_entry(
    snapshot: FinanceStateSnapshot,
    complication_key: str,
    active_keys: set[str],
) -> dict[str, Any]:
    config = load_cost_model()["complications"][complication_key]
    is_currently_included = complication_key in active_keys
    return {
        "key": complication_key,
        "label": config["display_label"],
        "calculator_supported": True,
        "is_currently_included": is_currently_included,
        "is_automatic": complication_key in AUTOMATIC_COMPLICATION_KEYS,
        "authoritative_range_text": get_complication_model_range_text(complication_key),
        "trigger_reason": (
            get_complication_trigger_reason(snapshot, complication_key)
            if is_currently_included
            else None
        ),
    }


def build_finance_presentation(
    snapshot: FinanceStateSnapshot,
) -> FinancePresentationInput:
    return FinancePresentationInput(
        address=snapshot.address,
        county=snapshot.county,
        adu_sqft=snapshot.adu_sqft,
        current_estimate_range=get_current_estimate_range(snapshot),
        base_estimate_value=snapshot.base_estimate_value,
        base_estimate_range=snapshot.base_estimate_range,
        complication_adjusted_value=snapshot.complication_adjusted_value,
        complication_adjusted_range=snapshot.complication_adjusted_range,
        automatic_addons=build_automatic_addons(snapshot),
        manual_addons=build_manual_addons(snapshot),
        active_complications=[
            build_complication_summary(snapshot, complication_key)
            for complication_key in get_active_complications(
                snapshot.complication_flags
            )
        ],
        modeled_complications=build_modeled_complication_catalog(snapshot),
        inactive_complication_keys=get_inactive_complications(
            snapshot.complication_flags
        ),
        missing_inputs=get_missing_inputs(snapshot),
    )


def build_automatic_addons(
    snapshot: FinanceStateSnapshot,
) -> list[FinanceComplicationOption]:
    automatic_addons: list[FinanceComplicationOption] = []
    for complication_key in AUTOMATIC_COMPLICATION_KEYS:
        if not getattr(snapshot.complication_flags, complication_key):
            continue
        automatic_addons.append(
            build_complication_option(
                snapshot,
                complication_key,
                is_selected=True,
            )
        )
    return automatic_addons


def build_manual_addons(
    snapshot: FinanceStateSnapshot,
) -> list[FinanceComplicationOption]:
    return [
        build_complication_option(
            snapshot,
            complication_key,
            is_selected=getattr(snapshot.complication_flags, complication_key),
        )
        for complication_key in MANUAL_COMPLICATION_KEYS
    ]


def build_complication_option(
    snapshot: FinanceStateSnapshot,
    complication_key: str,
    *,
    is_selected: bool,
) -> FinanceComplicationOption:
    return FinanceComplicationOption(
        key=complication_key,
        label=get_complication_label(complication_key),
        display_range_text=get_complication_model_range_text(complication_key),
        is_selected=is_selected,
        is_automatic=complication_key in AUTOMATIC_COMPLICATION_KEYS,
        trigger_reason=(
            get_complication_trigger_reason(snapshot, complication_key)
            if complication_key in AUTOMATIC_COMPLICATION_KEYS and is_selected
            else None
        ),
    )


def get_current_estimate_range(snapshot: FinanceStateSnapshot) -> EstimateRange | None:
    return snapshot.complication_adjusted_range or snapshot.base_estimate_range


def build_complication_summary(
    snapshot: FinanceStateSnapshot,
    complication_key: str,
) -> FinanceComplicationSummary:
    config = load_cost_model()["complications"][complication_key]
    midpoint_cost = calculate_complication_amount(complication_key, snapshot)
    range_low, range_high = calculate_complication_range(complication_key, snapshot)
    return FinanceComplicationSummary(
        key=complication_key,
        label=config["display_label"],
        kind=config["kind"],
        midpoint_cost=midpoint_cost,
        range_low=range_low,
        range_high=range_high,
        is_automatic=complication_key in AUTOMATIC_COMPLICATION_KEYS,
        trigger_reason=get_complication_trigger_reason(snapshot, complication_key),
        display_range_text=config.get("display_range"),
    )


def calculate_complication_range(
    complication_key: str,
    snapshot: FinanceStateSnapshot,
) -> tuple[float, float]:
    config = load_cost_model()["complications"][complication_key]
    kind = config["kind"]
    if kind == "percent_of_base":
        midpoint_cost = calculate_complication_amount(complication_key, snapshot)
        return midpoint_cost * 0.8, midpoint_cost * 1.2
    if kind == "percent_of_subtotal":
        midpoint_cost = calculate_complication_amount(complication_key, snapshot)
        return midpoint_cost * 0.8, midpoint_cost * 1.2
    if kind == "fixed_amount":
        return float(config["low"]), float(config["high"])
    return (
        float((snapshot.adu_sqft or 0.0) * config["low_per_sqft"]),
        float((snapshot.adu_sqft or 0.0) * config["high_per_sqft"]),
    )


def get_complication_trigger_reason(
    snapshot: FinanceStateSnapshot,
    complication_key: str,
) -> str | None:
    if complication_key == "solar_mandate":
        return "Included automatically because this is a detached ADU in California."
    if complication_key == "fire_resilient_upgrades":
        if snapshot.fire_hazard_severity == UNKNOWN_FIRE_HAZARD_SEVERITY:
            return (
                "Included automatically because the fire hazard zone is not specified "
                "yet. This allowance is tentative; confirm the fire hazard status in "
                "requirements before relying on the estimate."
            )
        severity = snapshot.fire_hazard_severity or "a fire hazard zone"
        return (
            "Included automatically because the property is in a "
            f"{severity} fire hazard zone where more resilient materials and "
            "possible sprinkler-related upgrades may be required."
        )
    if complication_key == "very_high_fire_risk":
        return (
            "Included automatically because the property is in a Very High fire "
            "hazard zone with stronger wildfire-compliance requirements."
        )
    if complication_key == "contingency":
        return "Included automatically as a 10% contingency for unforeseen construction conditions."
    return None


def get_missing_inputs(snapshot: FinanceStateSnapshot) -> list[str]:
    missing_inputs: list[str] = []
    if snapshot.adu_sqft is None:
        missing_inputs.append("adu_sqft")
    return missing_inputs
