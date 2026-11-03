"""Finance-state persistence and report snapshot helpers."""

from __future__ import annotations

from typing import Any

from pydantic import ValidationError

from .calculator import (
    build_finance_presentation,
    format_currency,
    format_range,
)
from .schemas import (
    EstimateRange,
    FinanceComplicationSummary,
    FinancePresentationInput,
    FinanceStateSnapshot,
)


def build_financial_snapshot(finance_state: FinanceStateSnapshot) -> str:
    presentation = build_finance_presentation(finance_state)
    return "\n".join(build_saved_financial_snapshot_lines(presentation))


def build_financial_snapshot_from_state(
    finance_state: FinanceStateSnapshot | dict[str, Any] | None,
) -> str:
    snapshot = coerce_finance_state(finance_state)
    if snapshot is None:
        return "\n".join(
            [
                "A calculator-backed cost range is not available yet. Complete one more finance pass before relying on this section.",
                "",
                "- **Financial standpoint:** The project needs one more calculator pass before cost guidance is ready.",
            ]
        )
    return build_financial_snapshot(snapshot)


def build_financial_report_context(
    finance_state: FinanceStateSnapshot | dict[str, Any] | None,
) -> str:
    snapshot = coerce_finance_state(finance_state)
    if snapshot is None:
        return "\n".join(
            [
                "Calculator finance context:",
                "- Estimate status: Financial estimate not started yet.",
                "- Financial standpoint: Wait for a calculator estimate before treating build costs as reliable.",
                "- Included add-ons: None yet.",
                "- Calculator-supported complications not currently included: Unknown until the calculator is started.",
            ]
        )

    presentation = build_finance_presentation(snapshot)
    return "\n".join(
        [
            "Calculator finance context:",
            *build_financial_report_lines(presentation),
        ]
    )


def coerce_finance_state(
    finance_state: FinanceStateSnapshot | dict[str, Any] | None,
) -> FinanceStateSnapshot | None:
    if finance_state is None:
        return None
    if isinstance(finance_state, FinanceStateSnapshot):
        return finance_state
    try:
        return FinanceStateSnapshot.model_validate(finance_state)
    except ValidationError:
        return None


def build_financial_report_lines(
    presentation: FinancePresentationInput,
) -> list[str]:
    return [
        *build_estimate_lines(presentation),
        f"- Financial standpoint: {build_financial_standpoint(presentation)}",
        *build_included_addon_lines(presentation),
        *build_modeled_complication_lines(presentation),
    ]


def build_estimate_lines(presentation: FinancePresentationInput) -> list[str]:
    if (
        presentation.base_estimate_value is None
        or presentation.base_estimate_range is None
    ):
        lines = ["- Estimate status: Financial estimate not started yet."]
        if presentation.missing_inputs:
            missing_inputs = ", ".join(presentation.missing_inputs)
            lines.append(f"- Missing calculator inputs: {missing_inputs}.")
        return lines

    lines = [
        "- Base estimate: "
        f"{format_currency(presentation.base_estimate_value)} "
        f"({format_range(presentation.base_estimate_range)})"
    ]

    current_estimate_range = presentation.current_estimate_range
    if (
        presentation.complication_adjusted_value is not None
        and presentation.complication_adjusted_range is not None
    ):
        lines.append(
            "- Current estimate with included add-ons: "
            f"{format_currency(presentation.complication_adjusted_value)} "
            f"({format_range(presentation.complication_adjusted_range)})"
        )
    elif current_estimate_range is not None:
        lines.append(f"- Current estimate: {format_range(current_estimate_range)}")
    return lines


def build_financial_standpoint(presentation: FinancePresentationInput) -> str:
    if presentation.base_estimate_range is None:
        return (
            "The project needs one more calculator pass before cost guidance is ready."
        )
    if presentation.active_complications:
        return (
            "Treat the adjusted estimate as the working budget to keep room for "
            "the extra add-ons included."
        )
    return (
        "Treat the base estimate as an early planning budget and leave room for "
        "site-specific add-ons if they are confirmed later."
    )


def build_saved_financial_snapshot_lines(
    presentation: FinancePresentationInput,
) -> list[str]:
    if presentation.base_estimate_range is None:
        return [
            "A calculator-backed cost range is not available yet. Complete one more finance pass before relying on this section.",
            "",
            "- **Financial standpoint:** The project needs one more calculator pass before cost guidance is ready.",
        ]

    current_estimate_range = get_current_report_range(presentation)
    lines = [
        build_saved_financial_summary(presentation, current_estimate_range),
        "",
        f"- **Base estimate range:** {format_report_range(presentation.base_estimate_range)}",
    ]

    if current_estimate_range is not None:
        lines.append(
            "- **Current estimate range:** "
            f"{format_report_range(current_estimate_range)}"
        )

    lines.extend(
        [
            f"- **Financial standpoint:** {build_financial_standpoint(presentation)}",
            "",
            "**Included in this estimate**",
            *build_saved_included_addon_lines(presentation),
            "",
            "**Not currently included**",
            *build_saved_modeled_complication_lines(presentation),
        ]
    )
    return lines


def get_current_report_range(
    presentation: FinancePresentationInput,
) -> EstimateRange | None:
    if presentation.complication_adjusted_range is not None:
        return presentation.complication_adjusted_range
    return presentation.current_estimate_range or presentation.base_estimate_range


def build_saved_financial_summary(
    presentation: FinancePresentationInput,
    current_estimate_range: EstimateRange | None,
) -> str:
    if current_estimate_range is None:
        return "A calculator-backed cost range is available, but the current planning range still needs one more pass."
    if presentation.active_complications:
        return (
            "The current planning range for this ADU is "
            f"**{format_report_range(current_estimate_range)}**. "
            "This already reflects the cost items included below."
        )
    return (
        "The current planning range for this ADU is "
        f"**{format_report_range(current_estimate_range)}** based on the current calculator inputs."
    )


def build_included_addon_lines(
    presentation: FinancePresentationInput,
) -> list[str]:
    if not presentation.active_complications:
        return ["- Included add-ons: None right now."]

    lines = ["- Included add-ons:"]
    for complication in presentation.active_complications:
        lines.append(
            f"- {complication.label}: {format_complication_detail(complication)}"
        )
    return lines


def format_complication_detail(complication: FinanceComplicationSummary) -> str:
    detail = complication.display_range_text or (
        f"{format_currency(complication.range_low)} - "
        f"{format_currency(complication.range_high)}"
    )
    status = "automatic" if complication.is_automatic else "manual"
    if complication.trigger_reason:
        return f"{detail} [{status}; {complication.trigger_reason}]"
    return f"{detail} [{status}]"


def build_saved_included_addon_lines(
    presentation: FinancePresentationInput,
) -> list[str]:
    if not presentation.active_complications:
        return [
            "- No additional cost items are currently reflected beyond the base estimate range."
        ]

    return [
        format_saved_included_addon_line(complication)
        for complication in presentation.active_complications
    ]


def format_saved_included_addon_line(
    complication: FinanceComplicationSummary,
) -> str:
    detail = normalize_report_detail_text(
        complication.display_range_text
        or f"{format_currency(complication.range_low)} - {format_currency(complication.range_high)}"
    )
    explanation = INCLUDED_ADDON_EXPLANATIONS.get(
        complication.key,
        "This cost item is already reflected in the current estimate range.",
    )
    label = get_report_complication_display_label(complication.key, complication.label)
    return f"- **{label}:** {detail}. {explanation}"


def not_included_modeled_complications(
    presentation: FinancePresentationInput,
) -> list[dict[str, Any]]:
    return [
        complication
        for complication in presentation.modeled_complications
        if not complication["is_currently_included"]
    ]


def build_modeled_complication_lines(
    presentation: FinancePresentationInput,
) -> list[str]:
    not_included = not_included_modeled_complications(presentation)
    if not not_included:
        return ["- Calculator-supported complications not currently included: None."]

    lines = ["- Calculator-supported complications not currently included:"]
    for complication in not_included:
        lines.append(
            "- "
            f"{complication['label']}: "
            f"{complication['authoritative_range_text']} "
            f"[{get_complication_selection_status(complication)}]"
        )
    return lines


def get_complication_selection_status(complication: dict[str, Any]) -> str:
    if complication["is_automatic"]:
        return "automatic when triggered"
    return "available add-on"


def build_saved_modeled_complication_lines(
    presentation: FinancePresentationInput,
) -> list[str]:
    not_included = not_included_modeled_complications(presentation)
    if not not_included:
        return ["- No additional modeled cost items are currently outstanding."]

    return [
        format_saved_modeled_complication_line(complication)
        for complication in not_included
    ]


def format_saved_modeled_complication_line(complication: dict[str, Any]) -> str:
    detail = normalize_report_detail_text(complication["authoritative_range_text"])
    explanation = EXCLUDED_ADDON_EXPLANATIONS.get(
        complication["key"],
        "This may apply if site conditions or project scope require it.",
    )
    label = get_report_complication_display_label(
        str(complication["key"]),
        str(complication["label"]),
    )
    return f"- **{label}:** {detail}. {explanation}"


def format_report_range(estimate_range: EstimateRange) -> str:
    return format_range(estimate_range).replace(" - ", " to ")


def normalize_report_detail_text(text: str) -> str:
    return text.replace(" - ", " to ").rstrip(".")


def get_report_complication_display_label(complication_key: str, label: str) -> str:
    if complication_key in {"very_high_fire_risk", "high_fire_risk"}:
        return "Very High fire risk compliance"
    return label


INCLUDED_ADDON_EXPLANATIONS = {
    "solar_mandate": "This is already reflected for California detached ADU solar compliance.",
    "fire_resilient_upgrades": "This is already reflected for wildfire-related materials and possible sprinkler upgrades.",
    "very_high_fire_risk": (
        "This is already reflected for Very High fire hazard zone wildfire-compliance requirements."
    ),
    "contingency": "This is already reflected to cover normal construction unknowns.",
    "electric_panel": "This is already reflected in the current estimate range.",
    "slope": "This is already reflected in the current estimate range.",
    "demolition": "This is already reflected in the current estimate range.",
    "septic_tank": "This is already reflected in the current estimate range.",
    "hoa_restrictions": "This is already reflected in the current estimate range.",
}


EXCLUDED_ADDON_EXPLANATIONS = {
    "slope": "This may apply if the site needs significant grading or retaining wall work.",
    "demolition": "This may apply if an existing structure or site feature needs to be removed.",
    "electric_panel": "This may apply if the existing electrical service cannot support the ADU.",
    "septic_tank": "This may apply if the septic system needs relocation or modification.",
    "fire_resilient_upgrades": "This may apply if wildfire-related material or sprinkler requirements are confirmed.",
    "very_high_fire_risk": (
        "This may apply if Very High fire hazard zone wildfire-compliance requirements are triggered."
    ),
    "hoa_restrictions": "This may apply if HOA design review adds material or design requirements.",
}


def persist_project_finance_state(
    project_id: str,
    finance_state: FinanceStateSnapshot,
    *,
    current_user_id: str,
) -> bool:
    from api.database.core import SessionLocal
    from api.database.repository import ReportRepository

    with SessionLocal() as db:
        project = ReportRepository.update_project_finance_state(
            db,
            project_id,
            finance_state.model_dump(mode="json"),
            user_id=current_user_id,
        )
        if project is None:
            return False
        return True
