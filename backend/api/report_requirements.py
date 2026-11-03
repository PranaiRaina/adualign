"""Guided requirement questions and report merge helpers."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from api.routers.schemas import RequirementOption, RequirementQuestion


REQUIREMENT_QUESTIONS: list[dict[str, Any]] = [
    {
        "id": "project_intent",
        "section": "Project Intent",
        "title": "Project Intent",
        "prompt": "What is the main reason you want to build this ADU?",
        "expected_fields": ["primary_use", "occupancy_goal", "rental_intent"],
        "placeholder": "Describe the main goal, who will use it, and whether rental income matters.",
        "options": [
            {
                "id": "long_term_rental_income",
                "label": "Long-term rental income",
                "description": "Prioritize rentability, operating assumptions, and return-on-cost context.",
                "normalized_value": {
                    "primary_use": "rental income",
                    "occupancy_goal": "long-term tenant",
                    "rental_intent": "long_term_rental",
                },
            },
            {
                "id": "family_multigenerational",
                "label": "Family or multigenerational housing",
                "description": "Focus the report on privacy, accessibility, and household fit.",
                "normalized_value": {
                    "primary_use": "family housing",
                    "occupancy_goal": "family_or_multigenerational",
                    "rental_intent": "not_primary",
                },
            },
            {
                "id": "flexible_guest_work",
                "label": "Flexible guest/work space",
                "description": "Keep the plan flexible for guests, office use, and future needs.",
                "normalized_value": {
                    "primary_use": "flexible guest or work space",
                    "occupancy_goal": "flexible_personal_use",
                    "rental_intent": "undecided",
                },
            },
            {
                "id": "not_sure_yet",
                "label": "Not sure yet",
                "description": "Preserve optionality while the feasibility picture gets clearer.",
                "normalized_value": {
                    "primary_use": "undecided",
                    "occupancy_goal": "undecided",
                    "rental_intent": "undecided",
                },
            },
        ],
    },
    {
        "id": "design_approach",
        "section": "Design Approach",
        "title": "Design Approach",
        "prompt": "How do you want to approach the ADU design?",
        "expected_fields": [
            "design_path",
            "customization_level",
            "professional_support_needed",
        ],
        "placeholder": "Mention custom design, prefab, standard plans, or what kind of design help you need.",
        "options": [
            {
                "id": "custom_designer_architect",
                "label": "Custom designer/architect",
                "description": "Plan around a site-specific design and professional drawings.",
                "normalized_value": {
                    "design_path": "custom_design",
                    "customization_level": "high",
                    "professional_support_needed": "designer_or_architect",
                },
            },
            {
                "id": "preapproved_standard_plan",
                "label": "Pre-approved or standard plan",
                "description": "Explore repeatable plans that may reduce design time.",
                "normalized_value": {
                    "design_path": "standard_or_preapproved_plan",
                    "customization_level": "medium",
                    "professional_support_needed": "plan_adaptation",
                },
            },
            {
                "id": "prefab_modular",
                "label": "Prefab/modular option",
                "description": "Evaluate factory-built options, delivery access, and utility tie-ins.",
                "normalized_value": {
                    "design_path": "prefab_or_modular",
                    "customization_level": "medium",
                    "professional_support_needed": "vendor_and_site_coordination",
                },
            },
            {
                "id": "need_help_deciding",
                "label": "Need help deciding",
                "description": "Compare design paths before committing to drawings or vendors.",
                "normalized_value": {
                    "design_path": "undecided",
                    "customization_level": "unknown",
                    "professional_support_needed": "options_review",
                },
            },
        ],
    },
    {
        "id": "budget_readiness",
        "section": "Budget Readiness",
        "title": "Budget Readiness",
        "prompt": "How should the report describe your current budget readiness?",
        "expected_fields": ["budget_status", "financing_source", "cost_sensitivity"],
        "placeholder": "Share a target budget, financing plan, or how sensitive you are to cost changes.",
        "options": [
            {
                "id": "target_budget",
                "label": "I have a target budget",
                "description": "Use your target as the constraint for scope and next-step recommendations.",
                "normalized_value": {
                    "budget_status": "target_budget_exists",
                    "financing_source": "unspecified",
                    "cost_sensitivity": "budget_constrained",
                },
            },
            {
                "id": "need_financing",
                "label": "I need financing or loan options",
                "description": "Frame the report around financing readiness and funding choices.",
                "normalized_value": {
                    "budget_status": "needs_financing",
                    "financing_source": "unknown_or_needed",
                    "cost_sensitivity": "financing_dependent",
                },
            },
            {
                "id": "still_estimating",
                "label": "I’m still estimating total cost",
                "description": "Keep cost ranges provisional until site and scope assumptions are confirmed.",
                "normalized_value": {
                    "budget_status": "still_estimating",
                    "financing_source": "unspecified",
                    "cost_sensitivity": "unknown",
                },
            },
            {
                "id": "lowest_practical_cost",
                "label": "Keep cost as low as practical",
                "description": "Emphasize simpler scope, standard finishes, and avoidable add-ons.",
                "normalized_value": {
                    "budget_status": "cost_minimization_priority",
                    "financing_source": "unspecified",
                    "cost_sensitivity": "high",
                },
            },
        ],
    },
    {
        "id": "site_concerns",
        "section": "Site Concerns",
        "title": "Site Concerns",
        "prompt": "Which site conditions should the report pay special attention to?",
        "expected_fields": ["site_risks", "known_constraints", "inspection_needed"],
        "placeholder": "List known utility, access, grading, tree, structure, HOA, or fire-zone concerns.",
        "options": [
            {
                "id": "utilities_electrical_capacity",
                "label": "Utilities or electrical capacity",
                "description": "Flag utility tie-ins, panel capacity, and service coordination.",
                "normalized_value": {
                    "site_risks": ["utilities", "electrical_capacity"],
                    "known_constraints": ["utility_coordination"],
                    "inspection_needed": "utility_review",
                },
            },
            {
                "id": "slope_grading_access",
                "label": "Slope, grading, drainage, or access",
                "description": "Focus on constructability, grading, drainage, and site access.",
                "normalized_value": {
                    "site_risks": ["slope", "grading", "drainage", "access"],
                    "known_constraints": ["site_work"],
                    "inspection_needed": "site_walk",
                },
            },
            {
                "id": "trees_setbacks_structures",
                "label": "Trees, setbacks, or existing structures",
                "description": "Track placement conflicts around protected areas and existing buildings.",
                "normalized_value": {
                    "site_risks": ["trees", "setbacks", "existing_structures"],
                    "known_constraints": ["placement_constraints"],
                    "inspection_needed": "placement_review",
                },
            },
            {
                "id": "no_known_site_concerns",
                "label": "No known site concerns yet",
                "description": "Keep site risks open until a professional review confirms conditions.",
                "normalized_value": {
                    "site_risks": [],
                    "known_constraints": [],
                    "inspection_needed": "standard_due_diligence",
                },
            },
        ],
    },
    {
        "id": "permit_timeline",
        "section": "Permit / Timeline",
        "title": "Permit / Timeline",
        "prompt": "What timeline or permit goal should guide the next steps?",
        "expected_fields": ["timeline_goal", "permit_urgency", "readiness_stage"],
        "placeholder": "Mention whether you are exploring, seeking quotes, preparing permit drawings, or working toward a target date.",
        "options": [
            {
                "id": "start_permit_planning",
                "label": "Start permit planning soon",
                "description": "Orient next steps around drawings, submittals, and local review.",
                "normalized_value": {
                    "timeline_goal": "start_permit_planning",
                    "permit_urgency": "soon",
                    "readiness_stage": "permit_planning",
                },
            },
            {
                "id": "compare_feasibility",
                "label": "Compare feasibility before committing",
                "description": "Keep the report focused on decision support and feasibility tradeoffs.",
                "normalized_value": {
                    "timeline_goal": "compare_feasibility",
                    "permit_urgency": "low",
                    "readiness_stage": "exploring",
                },
            },
            {
                "id": "need_quotes_first",
                "label": "Need contractor/designer quotes first",
                "description": "Prioritize scope definition and quote-ready assumptions.",
                "normalized_value": {
                    "timeline_goal": "get_quotes",
                    "permit_urgency": "medium",
                    "readiness_stage": "pricing",
                },
            },
            {
                "id": "no_timeline_yet",
                "label": "No timeline yet",
                "description": "Document that timing is flexible while feasibility is refined.",
                "normalized_value": {
                    "timeline_goal": "undecided",
                    "permit_urgency": "unknown",
                    "readiness_stage": "early_exploration",
                },
            },
        ],
    },
    {
        "id": "rental_operations",
        "section": "Rental Operations",
        "title": "Rental Operations",
        "prompt": "If this ADU may be rented, what operating assumptions should the report include?",
        "expected_fields": [
            "lease_strategy",
            "utilities_strategy",
            "privacy_parking_preferences",
        ],
        "placeholder": "Describe lease type, utilities, parking, privacy, pets, furnished status, or why rental does not apply.",
        "options": [
            {
                "id": "long_term_separate_utilities",
                "label": "Long-term tenant with separate utilities if possible",
                "description": "Use long-term leasing assumptions and track utility separation as a preference.",
                "normalized_value": {
                    "lease_strategy": "long_term",
                    "utilities_strategy": "separate_if_possible",
                    "privacy_parking_preferences": "tenant_privacy_priority",
                },
            },
            {
                "id": "family_flexible_cost_sharing",
                "label": "Family/friend occupancy with flexible cost sharing",
                "description": "Avoid over-optimizing for marketplace rental assumptions.",
                "normalized_value": {
                    "lease_strategy": "family_or_friend",
                    "utilities_strategy": "flexible_cost_sharing",
                    "privacy_parking_preferences": "household_fit",
                },
            },
            {
                "id": "short_term_verify_rules",
                "label": "Short-term rental interest, verify local rules",
                "description": "Flag short-term rental eligibility as a local-rule item to verify.",
                "normalized_value": {
                    "lease_strategy": "short_term_interest",
                    "utilities_strategy": "unknown",
                    "privacy_parking_preferences": "guest_turnover",
                },
            },
            {
                "id": "not_planning_to_rent",
                "label": "Not planning to rent",
                "description": "Keep rental assumptions out of the report unless plans change.",
                "normalized_value": {
                    "lease_strategy": "not_renting",
                    "utilities_strategy": "not_applicable",
                    "privacy_parking_preferences": "personal_use",
                },
            },
        ],
    },
]


def build_requirement_questions(project: Any) -> list[RequirementQuestion]:
    total_steps = len(REQUIREMENT_QUESTIONS)
    answered_requirements = get_saved_requirement_answers(project)
    return [
        RequirementQuestion(
            **{
                **question,
                "step": index + 1,
                "total_steps": total_steps,
                **answered_requirements.get(question["id"], {}),
                "options": [
                    RequirementOption(
                        **{
                            **option,
                            "recommended": is_recommended_option(
                                question["id"],
                                option["id"],
                                project,
                            ),
                        }
                    )
                    for option in question["options"]
                ],
            }
        )
        for index, question in enumerate(REQUIREMENT_QUESTIONS)
    ]


def get_saved_requirement_answers(project: Any) -> dict[str, dict[str, Any]]:
    visible = get_saved_requirement_visible(project)
    requirements = visible.get("requirements") if isinstance(visible, dict) else None
    if not isinstance(requirements, list):
        return {}

    answered: dict[str, dict[str, Any]] = {}
    for requirement in requirements:
        if not isinstance(requirement, dict):
            continue
        question_id = requirement.get("id")
        if not isinstance(question_id, str):
            continue
        status = requirement.get("status") or "answered"
        if status not in {"answered", "needs_review"}:
            status = "answered"
        answered[question_id] = {
            "status": status,
            "answered": True,
            "answer": requirement.get("answer"),
            "selected_option_id": requirement.get("selected_option_id"),
        }
    return answered


def get_saved_requirement_visible(project: Any) -> dict[str, Any]:
    report = getattr(project, "report", None)
    report_visible = getattr(report, "visible", None)
    if isinstance(report_visible, dict):
        return report_visible
    return {}


def get_requirement_question(
    question_id: str, project: Any
) -> RequirementQuestion | None:
    for question in build_requirement_questions(project):
        if question.id == question_id:
            return question
    return None


def get_requirement_option(
    question: RequirementQuestion,
    selected_option_id: str | None,
) -> RequirementOption | None:
    if selected_option_id is None:
        return None
    for option in question.options:
        if option.id == selected_option_id:
            return option
    return None


def is_recommended_option(question_id: str, option_id: str, project: Any) -> bool:
    finance_state = getattr(project, "finance_state", None) or {}
    primary_use = str(getattr(project, "primary_use", "") or "").lower()
    adu_type = str(getattr(project, "adu_type", "") or "").lower()
    fire_hazard = getattr(project, "fire_hazard_severity", None)
    blocker_types = getattr(project, "blocker_types", None) or []

    if question_id == "project_intent":
        if finance_state or "rent" in primary_use:
            return option_id == "long_term_rental_income"
        if "family" in primary_use:
            return option_id == "family_multigenerational"
    if question_id == "design_approach" and adu_type in {"prefab", "modular"}:
        return option_id == "prefab_modular"
    if question_id == "budget_readiness" and finance_state:
        return option_id == "still_estimating"
    if question_id == "site_concerns":
        blocker_text = " ".join(str(blocker).lower() for blocker in blocker_types)
        if fire_hazard or any(
            word in blocker_text for word in ("tree", "setback", "structure")
        ):
            return option_id == "trees_setbacks_structures"
        if any(word in blocker_text for word in ("utility", "electric", "panel")):
            return option_id == "utilities_electrical_capacity"
    if question_id == "permit_timeline":
        return option_id == "compare_feasibility"
    if question_id == "rental_operations" and (finance_state or "rent" in primary_use):
        return option_id == "long_term_separate_utilities"
    return False


def build_selected_option_display_answer(option: RequirementOption | None) -> str:
    if option is None:
        return ""
    return f"{option.label}: {option.description}"


def merge_visible_requirement(
    requirements: list[dict[str, Any]],
    *,
    question: RequirementQuestion,
    answer: str,
    selected_option_id: str | None,
    needs_review: bool,
) -> list[dict[str, Any]]:
    next_requirement = {
        "id": question.id,
        "title": question.title,
        "question": question.prompt,
        "answer": answer,
        "selected_option_id": selected_option_id,
        "status": "needs_review" if needs_review else "answered",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    return replace_by_id(requirements, next_requirement, id_key="id")


def merge_context_requirement_answer(
    requirement_answers: list[dict[str, Any]],
    *,
    question: RequirementQuestion,
    normalized_value: dict[str, Any],
    missing_fields: list[str],
    source: str,
) -> list[dict[str, Any]]:
    next_answer = {
        "question_id": question.id,
        "section": question.section,
        "normalized_value": normalized_value,
        "confidence": "low" if missing_fields else "high",
        "missing_fields": missing_fields,
        "source": source,
    }
    return replace_by_id(requirement_answers, next_answer, id_key="question_id")


def merge_requirement_open_items(
    existing_open_items: list[str],
    *,
    question: RequirementQuestion,
    missing_fields: list[str],
) -> list[str]:
    prefix = f"{question.title}: "
    retained = [item for item in existing_open_items if not item.startswith(prefix)]
    retained.extend(f"{prefix}{field}" for field in missing_fields)
    return dedupe_strings(retained)


def replace_by_id(
    items: list[dict[str, Any]],
    replacement: dict[str, Any],
    *,
    id_key: str,
) -> list[dict[str, Any]]:
    replaced = False
    next_items: list[dict[str, Any]] = []
    for item in items:
        if item.get(id_key) == replacement[id_key]:
            next_items.append(replacement)
            replaced = True
        else:
            next_items.append(item)
    if not replaced:
        next_items.append(replacement)
    return next_items


def dedupe_strings(values: list[str]) -> list[str]:
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
