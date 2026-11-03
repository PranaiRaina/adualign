"""Deterministic structured report composition."""

from __future__ import annotations

import random
from collections.abc import Sequence
from typing import Any, Callable

from api.property_context import (
    FIRE_BUILDING_SEPARATION_FT,
    clearance_meets_zoning_minimums,
    format_adu_dimensions,
    format_zoning_placement_clearances,
    get_project_adu_dimensions,
    is_non_rectangular_adu,
    normalize_adu_clearances,
)
from api.report_requirements import REQUIREMENT_QUESTIONS
from financial_chatbot.reporting import build_financial_snapshot_from_state

DEFAULT_MIN_ADU_SQFT = 200.0
UNKNOWN_FIRE_HAZARD_SEVERITY = "Unknown"
FIRE_HAZARD_ZONE_BULLETS = {
    "unknown": (
        "Fire hazard zone: Unknown — confirm this in chat for a more accurate "
        "wildfire-safety scope and cost estimate."
    ),
    "none": (
        "Fire hazard zone: None — no designated fire hazard zone is currently "
        "saved for this property."
    ),
    "very high": (
        "Fire hazard zone: Very High — plan for stronger wildfire-compliance "
        "requirements and confirm details with the local jurisdiction."
    ),
    "moderate": (
        "Fire hazard zone: Moderate — fire-resilient materials and safety upgrades "
        "may be required."
    ),
    "high": (
        "Fire hazard zone: High — fire-resilient materials and safety upgrades "
        "may be required."
    ),
}


def compose_report_from_project(
    project: Any,
    extraction: Any | None = None,
    *,
    existing_report: Any | None = None,
    preload_overlay: dict[str, Any] | None = None,
    include_guided_requirements: bool = False,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Build persisted report fields without LLM-authored visible prose.

    Preload overlay (chat-derived staging) is layered on top of the existing
    report so newer signals from chat win on conflict. Guided requirement
    fields remain available only for isolated legacy callers that opt in.
    """
    existing_visible = dict(getattr(existing_report, "visible", None) or {})
    existing_context = dict(getattr(existing_report, "context", None) or {})
    overlay_visible = dict((preload_overlay or {}).get("visible") or {})
    overlay_context = dict((preload_overlay or {}).get("context") or {})

    visible = {
        "executive_summary": build_executive_summary(project),
        "property_overview": build_property_overview(project),
        "zoning_analysis": build_zoning_analysis(project),
        "financial_snapshot": build_financial_snapshot_from_state(
            getattr(project, "finance_state", None)
        ),
        "recommendations": build_recommendations(project, extraction),
    }
    # Each context field merges a fresh source with existing + overlay signals
    # (newer signals win on conflict via dedupe_text order).
    context_sources = {
        "key_questions": get_list_field(extraction, "open_questions"),
        "implicit_preferences": get_list_field(extraction, "explicit_preferences"),
        "notable_signals": build_notable_signals(project, extraction),
    }
    context = {
        key: dedupe_text(
            [
                *fresh,
                *(existing_context.get(key) or []),
                *(overlay_context.get(key) or []),
            ]
        )
        for key, fresh in context_sources.items()
    }
    if include_guided_requirements:
        requirement_visible, requirement_context = build_guided_requirement_fields(
            (existing_visible, existing_context),
            (overlay_visible, overlay_context),
        )
        visible.update(requirement_visible)
        context.update(requirement_context)
    return visible, context


def build_guided_requirement_fields(
    existing: tuple[dict[str, Any], dict[str, Any]],
    overlay: tuple[dict[str, Any], dict[str, Any]],
) -> tuple[dict[str, Any], dict[str, Any]]:
    existing_visible, existing_context = existing
    overlay_visible, overlay_context = overlay
    requirements = merge_keyed_dict_list(
        existing_visible.get("requirements") or [],
        overlay_visible.get("requirements") or [],
        key="id",
    )
    answers = merge_keyed_dict_list(
        existing_context.get("requirement_answers") or [],
        overlay_context.get("requirement_answers") or [],
        key="question_id",
    )
    open_items = build_requirement_open_items(
        {"requirements": requirements},
        {
            "requirement_open_items": dedupe_text(
                [
                    *(existing_context.get("requirement_open_items") or []),
                    *(overlay_context.get("requirement_open_items") or []),
                ]
            ),
        },
    )
    return {"requirements": requirements}, {
        "requirement_answers": answers,
        "requirement_open_items": open_items,
    }


def merge_keyed_dict_list(
    existing: list[Any],
    overlay: list[Any],
    *,
    key: str,
) -> list[Any]:
    """Merge two lists of dicts so overlay entries replace existing entries
    sharing the same key, while non-dict items pass through unchanged.
    """
    by_key: dict[str, dict[str, Any]] = {}
    order: list[str] = []
    extras: list[Any] = []
    for item in [*existing, *overlay]:
        if isinstance(item, dict) and item.get(key):
            ident = str(item.get(key))
            if ident not in by_key:
                order.append(ident)
            by_key[ident] = item
            continue
        extras.append(item)
    return [by_key[ident] for ident in order] + extras


def build_executive_summary_assessment_template(location: str, adu_phrase: str) -> str:
    return "\n\n".join(
        [
            (
                f"This report presents a feasibility assessment for the proposed "
                f"{adu_phrase} at {location}. No significant regulatory or structural "
                "blockers have been identified at this stage. This ADU is preliminarily "
                "assessed as feasible."
            ),
            (
                "Final approval remains pending verification against site conditions "
                "and local submittal requirements."
            ),
        ]
    )


def build_executive_summary_review_template(location: str, adu_phrase: str) -> str:
    return "\n\n".join(
        [
            (
                f"A feasibility review has been completed for the proposed {adu_phrase} "
                f"at {location}. The findings indicate this project is preliminarily "
                "viable, with no major regulatory or structural obstacles identified. As "
                "with all ADU projects, final approval is subject to on-site verification "
                "and compliance with local submittal requirements."
            ),
            "For next steps review the 'Recommendations' section",
        ]
    )


EXECUTIVE_SUMMARY_TEMPLATES: tuple[
    Callable[[str, str], str], Callable[[str, str], str]
] = (
    build_executive_summary_assessment_template,
    build_executive_summary_review_template,
)


def choose_seeded_template(
    project: Any,
    *,
    section: str,
    templates: Sequence[Callable[..., str]],
) -> Callable[..., str]:
    project_id = str(getattr(project, "id", "") or "")
    rng = random.Random(f"{project_id}:{section}")
    return rng.choice(templates)


def build_executive_summary(project: Any) -> str:
    location = get_location(project)
    adu_phrase = build_executive_summary_adu_phrase(project)
    template = choose_seeded_template(
        project,
        section="executive_summary",
        templates=EXECUTIVE_SUMMARY_TEMPLATES,
    )
    return template(location, adu_phrase)


def build_executive_summary_adu_phrase(project: Any) -> str:
    adu_sqft = getattr(project, "adu_sqft", None)
    adu_type = format_label(getattr(project, "adu_type", None))
    adu_shape = format_label(getattr(project, "adu_shape", None))

    parts: list[str] = []
    if adu_sqft is not None:
        parts.append(f"{int(adu_sqft):,d} sq ft")
    if adu_shape and is_non_rectangular_adu(project):
        parts.append(adu_shape)
    if adu_type:
        parts.append(adu_type)
    parts.append("ADU")

    if len(parts) == 1:
        return "proposed ADU"
    return " ".join(parts)


def build_property_overview(project: Any) -> str:
    dimensions_label, dimensions_value = build_adu_dimensions_row(project)
    rows = [
        ("Address", getattr(project, "address", None)),
        ("County", getattr(project, "county", None)),
        ("Property area", format_sqft(getattr(project, "property_area_sqft", None))),
        ("Buildable area", format_sqft(getattr(project, "buildable_area_sqft", None))),
        ("Required setback", format_feet(getattr(project, "setback_ft", None))),
        ("Max ADU allowed", format_sqft(getattr(project, "max_adu_sqft", None))),
        ("Planned ADU size", format_sqft(getattr(project, "adu_sqft", None))),
        (dimensions_label, dimensions_value),
        ("ADU type", format_label(getattr(project, "adu_type", None))),
        ("ADU shape", format_label(getattr(project, "adu_shape", None))),
        ("Current yard zone", getattr(project, "current_yard_zone", None)),
    ]
    filled_rows = [(label, value) for label, value in rows if value]
    if not filled_rows:
        return "Property details have not been saved yet. Add map and project inputs to complete this section."

    table = ["| Field | Current value |", "| --- | --- |"]
    table.extend(f"| {label} | {value} |" for label, value in filled_rows)

    dimensions_notice = build_adu_dimensions_notice(project)
    if dimensions_notice:
        table.extend(["", dimensions_notice])

    primary_use = getattr(project, "primary_use", None)
    if primary_use:
        table.extend(["", f"Primary planned use: {primary_use}."])

    return "\n".join(table)


def build_adu_dimensions_row(project: Any) -> tuple[str, str | None]:
    width, length = get_project_adu_dimensions(project)
    dimensions = format_adu_dimensions(width, length)
    if is_non_rectangular_adu(project):
        return "Overall footprint*", dimensions
    return "ADU dimensions", dimensions


def build_adu_dimensions_notice(project: Any) -> str | None:
    if not is_non_rectangular_adu(project):
        return None
    width, length = get_project_adu_dimensions(project)
    if not format_adu_dimensions(width, length):
        return None

    shape = format_label(getattr(project, "adu_shape", None)) or "non-rectangular"
    return (
        f"*Overall footprint describes the full outer width and depth of the {shape} "
        "ADU, not each individual leg."
    )


def build_zoning_analysis(project: Any) -> str:
    bullets: list[str] = []
    bullets.append(build_zoning_fire_hazard_bullet(project))

    max_adu_bullet = build_zoning_max_adu_bullet(project)
    if max_adu_bullet:
        bullets.append(max_adu_bullet)

    parcel_setback_bullet = build_zoning_parcel_setback_bullet(project)
    if parcel_setback_bullet:
        bullets.append(parcel_setback_bullet)

    bullets.append(build_zoning_fire_setback_bullet())

    clearance_bullet = build_zoning_clearance_bullet(project)
    if clearance_bullet:
        bullets.append(clearance_bullet)

    blockers = get_blockers(project)
    if blockers:
        bullets.append(
            "- Potential site constraints to resolve during design: "
            f"{join_human_list(blockers)}."
        )

    bullets.extend(build_zoning_advisory_bullets(project))

    bullets.append(build_zoning_confirmation_bullet(project))

    if len(bullets) <= 2 and clearance_bullet is None and max_adu_bullet is None:
        return (
            "No zoning constraints are saved yet. Confirm setbacks, maximum size, "
            "placement clearances, and local review requirements before relying on "
            "feasibility assumptions."
        )

    return "\n".join(bullets)


# CA's statewide exemption protects ADUs up to 800 sqft; above it the 50%-of-
# living-area cap (attached) and front-yard placement become local-discretion
# questions. Mirrors the frontend advisory rules (attachedSizeRule.ts,
# frontYardRule.ts) — advisory bullets only, never blocking.
STATEWIDE_EXEMPTION_SQFT = 800


def build_zoning_advisory_bullets(project: Any) -> list[str]:
    adu_sqft = getattr(project, "adu_sqft", None)
    if not adu_sqft or float(adu_sqft) <= STATEWIDE_EXEMPTION_SQFT:
        return []

    bullets: list[str] = []
    if getattr(project, "adu_type", None) == "attached":
        home_sqft = getattr(project, "home_sqft", None)
        if home_sqft and float(adu_sqft) > float(home_sqft) / 2:
            bullets.append(
                build_zoning_bullet(
                    "California caps attached ADUs over 800 sq ft at 50% of the "
                    "home's living area. County records suggest this unit may "
                    "exceed that; verify with the city."
                )
            )
        elif not home_sqft:
            bullets.append(
                build_zoning_bullet(
                    "California caps attached ADUs over 800 sq ft at 50% of the "
                    "home's living area. The home's living area could not be "
                    "verified from county records; confirm before finalizing plans."
                )
            )

    yard_zone = getattr(project, "current_yard_zone", None) or ""
    if "front" in yard_zone.lower():
        bullets.append(
            build_zoning_bullet(
                "California protects front yard ADU placement only up to 800 sq ft. "
                "Larger units in the front yard depend on local rules; verify with "
                "the city."
            )
        )
    return bullets


def build_zoning_bullet(text: str) -> str:
    stripped = text.strip()
    if stripped.startswith("- "):
        return stripped
    return f"- {stripped}"


def build_zoning_fire_hazard_bullet(project: Any) -> str:
    fire_hazard = getattr(project, "fire_hazard_severity", None) or "Unknown"
    normalized = str(fire_hazard).strip().lower()
    if normalized in FIRE_HAZARD_ZONE_BULLETS:
        return build_zoning_bullet(FIRE_HAZARD_ZONE_BULLETS[normalized])
    severity_label = format_label(fire_hazard) or str(fire_hazard)
    return build_zoning_bullet(
        f"Fire hazard zone: {severity_label} — confirm applicable wildfire-safety "
        "requirements with the local jurisdiction."
    )


def get_permitted_adu_sqft_bounds(project: Any) -> tuple[float, float | None]:
    min_sqft = float(getattr(project, "min_adu_sqft", None) or DEFAULT_MIN_ADU_SQFT)
    max_sqft = getattr(project, "max_adu_sqft", None)
    return min_sqft, float(max_sqft) if max_sqft is not None else None


def build_zoning_max_adu_bullet(project: Any) -> str | None:
    min_sqft, max_sqft = get_permitted_adu_sqft_bounds(project)
    min_label = format_sqft(min_sqft)
    adu_sqft = getattr(project, "adu_sqft", None)

    if max_sqft is None:
        return None

    max_label = format_sqft(max_sqft)
    range_intro = f"The permitted ADU size for this property ranges from {min_label} to {max_label}"

    if adu_sqft is None:
        return build_zoning_bullet(
            f"{range_intro} — confirm the planned unit size against this range before "
            "permit drawings."
        )

    planned_sqft = float(adu_sqft)
    if min_sqft <= planned_sqft <= max_sqft:
        return build_zoning_bullet(
            f"{range_intro} — the proposed unit is within compliance."
        )

    if planned_sqft < min_sqft:
        planned_label = format_sqft(planned_sqft)
        return build_zoning_bullet(
            f"{range_intro} — the proposed unit at {planned_label} is below the "
            "minimum and should be confirmed with the jurisdiction."
        )

    planned_label = format_sqft(planned_sqft)
    return build_zoning_bullet(
        f"{range_intro} — the proposed unit at {planned_label} exceeds the permitted "
        "maximum and should be resized or confirmed with the jurisdiction."
    )


def build_zoning_parcel_setback_bullet(project: Any) -> str | None:
    setback_ft = getattr(project, "setback_ft", None)
    if setback_ft is None:
        return None

    setback_label = format_feet(setback_ft)
    return build_zoning_bullet(
        f"The required minimum parcel setback is set at {setback_label} "
        "on all applicable sides."
    )


def build_zoning_fire_setback_bullet() -> str:
    separation_ft = int(FIRE_BUILDING_SEPARATION_FT)
    return build_zoning_bullet(
        f"The required minimum property setback for fire safety is set at "
        f"{separation_ft} ft on all applicable sides."
    )


def build_zoning_clearance_bullet(project: Any) -> str | None:
    clearances = normalize_adu_clearances(getattr(project, "adu_clearances", None))
    clearance_summary = format_zoning_placement_clearances(clearances)
    if not clearance_summary:
        return None

    setback_ft = getattr(project, "setback_ft", None)
    parcel_setback = float(setback_ft) if setback_ft is not None else None
    all_within_minimums = all(
        clearance_meets_zoning_minimums(
            clearance,
            parcel_setback_ft=parcel_setback,
        )
        for clearance in clearances
    )
    compliance_phrase = (
        "all clearances are within range of the minimums"
        if all_within_minimums
        else "one or more clearances should be reviewed against the minimum setbacks"
    )
    return build_zoning_bullet(
        f"Current placement clearances: {clearance_summary} — {compliance_phrase}."
    )


def build_zoning_confirmation_bullet(project: Any) -> str:
    county = getattr(project, "county", None)
    if county:
        department = f"the {county} planning department"
    else:
        department = "the local planning department"
    return build_zoning_bullet(
        f"All zoning parameters and clearances should be confirmed with {department} or other such local agency"
        " prior to permit drawings or contractor pricing."
    )


def build_recommendations_advance_template(
    project: Any,
    extraction: Any | None,
) -> str:
    location = get_location(project)
    proposed = build_proposed_adu_phrase(project)
    concerns = get_list_field(extraction, "concerns")
    intro = (
        "The following next steps are recommended to advance this project from "
        f"feasibility into a permit-ready scope for {proposed} at {location}."
    )
    bullets = [
        build_permit_package_recommendation(),
        build_budget_recommendation(project),
        build_site_review_recommendation(project, concerns),
        build_coordination_recommendation(project),
        build_design_priorities_recommendation(),
    ]
    return format_recommendations_section(intro, bullets)


def build_recommendations_permitting_template(
    project: Any,
    extraction: Any | None,
) -> str:
    location = get_location(project)
    proposed = build_proposed_adu_phrase(project)
    concerns = get_list_field(extraction, "concerns")
    intro = (
        f"To move {proposed} at {location} from feasibility into permitting, "
        "the following steps are advised."
    )
    bullets = [
        build_permitting_submittal_package_recommendation(),
        build_permitting_budget_recommendation(project),
        build_permitting_site_review_recommendation(project, concerns),
        build_permitting_coordination_recommendation(project),
        build_permitting_design_priorities_recommendation(),
    ]
    return format_recommendations_section(intro, bullets)


RECOMMENDATIONS_TEMPLATES: tuple[
    Callable[[Any, Any | None], str],
    Callable[[Any, Any | None], str],
] = (
    build_recommendations_advance_template,
    build_recommendations_permitting_template,
)


def format_recommendations_section(intro: str, bullets: list[str]) -> str:
    return "\n\n".join([intro, *[f"- {bullet}" for bullet in bullets]])


def build_recommendations(project: Any, extraction: Any | None) -> str:
    template = choose_seeded_template(
        project,
        section="recommendations",
        templates=RECOMMENDATIONS_TEMPLATES,
    )
    return template(project, extraction)


def build_notable_signals(project: Any, extraction: Any | None) -> list[str]:
    signals = [
        *get_list_field(extraction, "conversation_highlights"),
        *get_list_field(extraction, "timeline_notes"),
        *get_list_field(extraction, "budget_notes"),
    ]
    fire_hazard = getattr(project, "fire_hazard_severity", None)
    if fire_hazard:
        signals.append(f"Saved fire hazard severity: {fire_hazard}")
    blockers = get_blockers(project)
    if blockers:
        signals.append(f"Saved potential blockers: {', '.join(blockers)}")
    return dedupe_text(signals)


def build_requirement_open_items(
    existing_visible: dict[str, Any],
    existing_context: dict[str, Any],
) -> list[str]:
    answered_ids = {
        requirement.get("id")
        for requirement in existing_visible.get("requirements", [])
        if isinstance(requirement, dict)
    }
    unanswered_questions = [
        f"{question['title']}: {question['prompt']}"
        for question in REQUIREMENT_QUESTIONS
        if question["id"] not in answered_ids
    ]
    return dedupe_text(
        [
            *(existing_context.get("requirement_open_items") or []),
            *unanswered_questions,
        ]
    )


def build_project_descriptor(project: Any) -> str:
    adu_sqft = getattr(project, "adu_sqft", None)
    adu_type = format_label(getattr(project, "adu_type", None))
    if adu_sqft and adu_type:
        return f"the planned {int(adu_sqft):,d} sq ft {adu_type} ADU"
    if adu_sqft:
        return f"the planned {int(adu_sqft):,d} sq ft ADU"
    if adu_type:
        return f"the planned {adu_type} ADU"
    return "the ADU project"


def build_proposed_adu_phrase(project: Any) -> str:
    adu_sqft = getattr(project, "adu_sqft", None)
    adu_type = format_label(getattr(project, "adu_type", None))
    if adu_sqft and adu_type:
        return f"the proposed {int(adu_sqft):,d} sq ft {adu_type} ADU"
    if adu_sqft:
        return f"the proposed {int(adu_sqft):,d} sq ft ADU"
    if adu_type:
        return f"the proposed {adu_type} ADU"
    return "the proposed ADU"


def build_permit_package_recommendation() -> str:
    return (
        "Develop a permit-ready package including a site plan, floor plan, elevations, "
        "and code notes aligned with the findings of this report."
    )


def build_budget_recommendation(project: Any) -> str:
    finance_state = getattr(project, "finance_state", None) or {}
    has_estimate = bool(
        finance_state.get("base_estimate_range")
        or finance_state.get("complication_adjusted_range")
    )
    baseline_phrase = (
        "Use the preliminary cost estimate as a working budget baseline"
        if has_estimate
        else "Establish a preliminary cost estimate as a working budget baseline"
    )
    return (
        f"{baseline_phrase}, then confirm permit fees, utility connection costs, "
        "and any site-specific line items before finalizing scope."
    )


def build_site_review_recommendation(project: Any, concerns: list[str]) -> str:
    separation_ft = int(FIRE_BUILDING_SEPARATION_FT)
    setback_phrase = (
        f"including the {separation_ft} ft minimum property setback requirement"
    )
    fire_hazard = getattr(project, "fire_hazard_severity", None)
    if is_unknown_fire_hazard(fire_hazard):
        return (
            "Complete a site-specific review confirming fire hazard status and "
            f"related fire-resilient requirements, {setback_phrase}."
        )
    if fire_hazard:
        severity_label = format_label(fire_hazard) or str(fire_hazard)
        return (
            f"Complete a site-specific review addressing {severity_label} fire hazard "
            f"zone compliance, {setback_phrase}."
        )

    review_items = dedupe_text(
        [
            *(concerns[:2] if concerns else []),
            *get_blockers(project),
        ]
    )
    if review_items:
        return (
            f"Complete a site-specific review addressing {join_human_list(review_items)}, "
            f"{setback_phrase}."
        )
    return (
        "Complete a site-specific review covering access, grading, utility tie-ins, "
        f"and existing conditions, {setback_phrase}."
    )


def build_coordination_recommendation(project: Any) -> str:
    county = getattr(project, "county", None)
    if county:
        jurisdiction = f"{county}'s local submittal process"
    else:
        jurisdiction = "local submittal requirements"
    return (
        "Engage an ADU-experienced designer or permit expediter familiar with "
        f"{jurisdiction} early in the design phase."
    )


def build_design_priorities_recommendation() -> str:
    return (
        "Establish non-negotiable design priorities — layout, privacy, storage, and "
        "finishes — before entering final design to avoid costly revisions."
    )


def build_permitting_submittal_package_recommendation() -> str:
    return (
        "Prepare a complete permit submittal package — site plan, floor plan, "
        "elevations, and code notes — consistent with the regulatory findings "
        "outlined in this report."
    )


def build_permitting_budget_recommendation(project: Any) -> str:
    finance_state = getattr(project, "finance_state", None) or {}
    has_estimate = bool(
        finance_state.get("base_estimate_range")
        or finance_state.get("complication_adjusted_range")
    )
    starting_point = (
        "Treat the preliminary cost estimate as a starting point"
        if has_estimate
        else "Establish a preliminary cost estimate as a starting point"
    )
    return (
        f"{starting_point}; verify permit fees, utility hookup costs, and "
        "site-specific expenses before committing to a final budget."
    )


def build_permitting_site_review_recommendation(
    project: Any,
    concerns: list[str],
) -> str:
    separation_ft = int(FIRE_BUILDING_SEPARATION_FT)
    setback_phrase = (
        f"including the required {separation_ft} ft minimum property setback"
    )
    fire_hazard = getattr(project, "fire_hazard_severity", None)
    if is_unknown_fire_hazard(fire_hazard):
        return (
            "Conduct a site-specific review to confirm fire hazard status and "
            f"related fire-resilient requirements, {setback_phrase}."
        )
    if fire_hazard:
        severity_label = format_label(fire_hazard) or str(fire_hazard)
        return (
            "Conduct a site-specific review to confirm compliance with "
            f"{severity_label} fire hazard zone standards, {setback_phrase}."
        )

    review_items = dedupe_text(
        [
            *(concerns[:2] if concerns else []),
            *get_blockers(project),
        ]
    )
    if review_items:
        return (
            "Conduct a site-specific review to confirm compliance with "
            f"{join_human_list(review_items)}, {setback_phrase}."
        )
    return (
        "Conduct a site-specific review to confirm access, grading, utility tie-ins, "
        f"and existing conditions, {setback_phrase}."
    )


def build_permitting_coordination_recommendation(project: Any) -> str:
    county = getattr(project, "county", None)
    if county:
        jurisdiction = f"{county} ADU approvals"
    else:
        jurisdiction = "local ADU approvals"
    return (
        "Engage early with a designer or permit expediter experienced in "
        f"{jurisdiction} to avoid delays during the submittal process."
    )


def build_permitting_design_priorities_recommendation() -> str:
    return (
        "Lock in core design priorities — including layout, privacy, storage, and "
        "finish level — prior to final design to minimize change orders and cost "
        "overruns."
    )


def build_use_case_recommendation(project: Any, extraction: Any | None) -> str:
    return build_design_priorities_recommendation()


def get_location(project: Any) -> str:
    return getattr(project, "address", None) or "this property"


def get_blockers(project: Any) -> list[str]:
    blockers = getattr(project, "blocker_types", None) or []
    return [str(blocker) for blocker in blockers if str(blocker).strip()]


def get_list_field(extraction: Any | None, field_name: str) -> list[str]:
    if extraction is None:
        return []
    value = getattr(extraction, field_name, None)
    if not isinstance(value, list):
        return []
    return dedupe_text(str(item) for item in value if str(item).strip())


def dedupe_text(values: Any) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        normalized = " ".join(str(value).split())
        key = normalized.lower()
        if not normalized or key in seen:
            continue
        seen.add(key)
        result.append(normalized)
    return result


def join_human_list(items: list[str]) -> str:
    if len(items) <= 1:
        return items[0] if items else ""
    if len(items) == 2:
        return f"{items[0]} and {items[1]}"
    return f"{', '.join(items[:-1])}, and {items[-1]}"


def format_sqft(value: Any) -> str | None:
    if value is None:
        return None
    return f"{int(value):,d} sq ft"


def format_feet(value: Any) -> str | None:
    if value is None:
        return None
    return f"{int(value)} ft"


def format_label(value: Any) -> str | None:
    if not value:
        return None
    return str(value).replace("_", " ").title()


def is_unknown_fire_hazard(value: Any) -> bool:
    return str(value or "").strip().lower() == UNKNOWN_FIRE_HAZARD_SEVERITY.lower()
