"""
Report hydration — composes a stored report into a system prompt fragment.

This is the "Query or Context (report injected here)" node from the
architecture diagram. On session load the report is fetched and both
the visible and context layers are formatted into a block that gets
prepended to the orchestrator and agent system prompts.

The invisible context section is delimited with:
    ## CONTEXT: NOT SHOWN TO USER ##
as specified in Report_Architecture.md §2.3.
"""

from __future__ import annotations

import json
from typing import Any

from api.property_context import (
    build_property_footprint_supplement,
    footprint_mentioned_in_text,
    format_adu_clearances,
    format_adu_footprint_bullet,
    is_non_rectangular_adu_shape,
)


def format_project_label(value: Any) -> str:
    return str(value).replace("_", " ").title()


def compose_answer_safe_context(
    visible: dict[str, Any],
    project: Any | None = None,
    *,
    include_guided_requirements: bool = False,
) -> str:
    """Build user-safe project context from report visible sections.

    When a project is provided, append saved footprint dimensions if they are
    missing from the composed report text (common after regenerate without DB
    width/length or when only structured project fields still have them).
    """
    parts: list[str] = []

    parts.append("## LOCAL PROJECT REPORT DATA - NOT A CITABLE SOURCE ##")
    parts.append("")

    if visible.get("executive_summary"):
        parts.append(f"### Executive Summary\n{visible['executive_summary']}")

    if visible.get("property_overview"):
        parts.append(f"### Property Overview\n{visible['property_overview']}")

    if visible.get("zoning_analysis"):
        parts.append(f"### Zoning & Regulatory Analysis\n{visible['zoning_analysis']}")

    if visible.get("financial_snapshot"):
        parts.append(f"### Financial Snapshot\n{visible['financial_snapshot']}")

    if include_guided_requirements and visible.get("requirements"):
        requirements = format_visible_requirements(visible["requirements"])
        if requirements:
            parts.append(f"### Requirements & Owner Inputs\n{requirements}")

    if visible.get("recommendations"):
        parts.append(f"### Recommendations\n{visible['recommendations']}")

    body = "\n".join(parts)
    if project is None:
        return body

    supplement = build_property_footprint_supplement(project)
    if supplement and not footprint_mentioned_in_text(body):
        if body.strip():
            return f"{body}\n\n{supplement}"
        return supplement
    return body


def compose_internal_context(
    context: dict[str, Any],
    *,
    include_guided_requirements: bool = False,
) -> str:
    """Build the internal-only project context block."""
    parts: list[str] = []
    parts.append("")
    parts.append("## LOCAL INTERNAL CONTEXT - NOT A CITABLE SOURCE ##")
    parts.append("")

    if context.get("key_questions"):
        qs = "\n".join(f"- {q}" for q in context["key_questions"])
        parts.append(f"### Key Questions\n{qs}")

    if context.get("implicit_preferences"):
        prefs = "\n".join(f"- {p}" for p in context["implicit_preferences"])
        parts.append(f"### Implicit Preferences\n{prefs}")

    if context.get("notable_signals"):
        sigs = "\n".join(f"- {s}" for s in context["notable_signals"])
        parts.append(f"### Notable Signals\n{sigs}")

    if include_guided_requirements and context.get("requirement_answers"):
        answers = json.dumps(
            context["requirement_answers"],
            separators=(",", ":"),
        )
        parts.append(f"### Requirement Answers\n{answers}")

    if include_guided_requirements and context.get("requirement_open_items"):
        open_items = "\n".join(
            f"- {item}" for item in context["requirement_open_items"]
        )
        parts.append(f"### Requirement Open Items\n{open_items}")

    if context.get("citation_metadata"):
        # We use minified JSON to maximize token efficiency in our situational awareness prompts.
        cites = json.dumps(context["citation_metadata"], separators=(",", ":"))
        parts.append(f"### Citation Metadata\n{cites}")

    if not any(part.strip() for part in parts[3:]):
        return ""

    parts.append("")
    parts.append("## END CONTEXT ##")
    return "\n".join(parts)


def format_visible_requirements(requirements: Any) -> str:
    if not isinstance(requirements, list):
        return ""

    lines: list[str] = []
    for requirement in requirements:
        if not isinstance(requirement, dict):
            continue
        title = str(requirement.get("title") or "Requirement").strip()
        answer = str(requirement.get("answer") or "").strip()
        if answer:
            lines.append(f"- {title}: {answer}")
    return "\n".join(lines)


def compose_property_context(project: Any) -> str:
    """
    Build a concise property data block from a Project ORM instance.
    Used when no report exists yet (first message in a new project).
    """
    lines: list[str] = []
    if project.address:
        lines.append(f"- Address: {project.address}")
    if project.county:
        lines.append(f"- County: {project.county}")
    if project.property_area_sqft:
        lines.append(f"- Property Area: {int(project.property_area_sqft):,d} sq ft")
    if project.buildable_area_sqft:
        lines.append(f"- Buildable Area: {int(project.buildable_area_sqft):,d} sq ft")
    if project.setback_ft:
        lines.append(f"- Setback: {int(project.setback_ft)} ft")
    if project.max_adu_sqft:
        lines.append(f"- Max ADU Allowed: {int(project.max_adu_sqft):,d} sq ft")
    if project.adu_sqft:
        lines.append(f"- Planned ADU Size: {int(project.adu_sqft):,d} sq ft")
    if project.adu_type:
        lines.append(f"- ADU Type: {format_project_label(project.adu_type)}")
    adu_shape = getattr(project, "adu_shape", None)
    if adu_shape:
        lines.append(f"- ADU Shape: {format_project_label(adu_shape)}")
    footprint_dimensions = format_adu_footprint_bullet(project)
    if footprint_dimensions:
        lines.append(footprint_dimensions)
        if is_non_rectangular_adu_shape(adu_shape):
            lines.append(
                "- ADU Footprint Note: dimensions are the outer bounding box; "
                "leg details remain in the saved map."
            )
    if project.primary_use:
        lines.append(f"- Primary Use: {project.primary_use}")
    fire_hazard_severity = getattr(project, "fire_hazard_severity", None)
    if fire_hazard_severity:
        lines.append(f"- Fire Hazard Severity: {fire_hazard_severity}")
    fire_hazard_zone_type = getattr(project, "fire_hazard_zone_type", None)
    if fire_hazard_zone_type:
        lines.append(f"- Fire Hazard Zone Type: {fire_hazard_zone_type}")
    current_yard_zone = getattr(project, "current_yard_zone", None)
    if current_yard_zone:
        lines.append(f"- Current Yard Zone: {current_yard_zone}")
    clearance_summary = format_adu_clearances(getattr(project, "adu_clearances", None))
    if clearance_summary:
        lines.append(f"- ADU Clearances: {clearance_summary}")
    blocker_types = getattr(project, "blocker_types", None)
    if blocker_types:
        lines.append(f"- Potential Blockers: {', '.join(blocker_types)}")

    if not lines:
        return ""
    return "## PROPERTY DATA ##\n" + "\n".join(lines)
