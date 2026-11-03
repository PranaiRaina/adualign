"""
API Router for structured report CRUD, project management, draft lifecycle,
and publish/archive operations.
"""

from __future__ import annotations
from datetime import datetime, timezone
import json
import logging
import re
from typing import Any, Literal, TypeVar, cast

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.database.core import get_db
from api.database.models import Listing, Project, Report, User
from api.database.repository import ConflictError, ReportRepository
from api.errors import GENERIC_ERROR_MESSAGE
from api.rate_limiting.llm_usage import (
    REPORT_GENERATION_LOG_TAG,
    log_guided_requirements_turn_usage,
    record_litellm_usage,
    usage_accumulator_scope,
)
from api.property_context import (
    footprint_dimensions_label_for_shape,
    format_adu_clearances,
)
from api.rate_limiting.rate_limiter import ensure_user_api_key, reserve_llm_budget
from api.report_sanitizer import (
    sanitize_report_context_fields,
    sanitize_report_text,
    sanitize_report_visible_fields,
)
from api.report_composer import compose_report_from_project
from api.report_requirements import (
    build_requirement_questions,
    get_requirement_option,
    get_requirement_question,
    merge_context_requirement_answer,
    merge_requirement_open_items,
    merge_visible_requirement,
)
from api.database.schemas import (
    DraftOut,
    DraftUpdate,
    ProjectCreate,
    ProjectOut,
    ProjectUpdate,
    ReportOut,
    ReportUpdate,
)
from financial_chatbot.reporting import (
    build_financial_report_context,
)
from .schemas import (
    GenerateStructuredReportRequest,
    RequirementAnswerRequest,
    RequirementAnswerResponse,
    RequirementQuestionsResponse,
    RequirementValidationOutput,
    StructuredReportOutput,
    ParsedListingData,
    ParsedListingDraftResponse,
    MergeChange,
    ParseReportRequest,
    PARSE_SYSTEM_PROMPT,
    ListingDraftData,
    ListingFieldMeta,
)
from ..authentication.auth import get_current_user
from api.llm import LONG, acompletion_resilient
from api.rate_limiting.llm_pricing import (
    CHAT_COMPLETION_MODEL,
    LITELLM_CHAT_MODEL,
    reasoning_kwargs,
)
from api.utils import get_openrouter_key

logger = logging.getLogger(__name__)
REPORT_MODEL = CHAT_COMPLETION_MODEL
LITELLM_REPORT_MODEL = LITELLM_CHAT_MODEL
StructuredOutputT = TypeVar("StructuredOutputT", bound=BaseModel)

router = APIRouter(prefix="/projects", tags=["projects & reports"])
util_router = APIRouter(tags=["utils"])
UNKNOWN_FIRE_HAZARD_SEVERITY = "Unknown"
MARKDOWN_BULLET_RE = re.compile(r"^[-*+]\s+(.*)$")
MARKDOWN_NUMBERED_RE = re.compile(r"^\d+\.\s+(.*)$")
REQUIREMENT_VALIDATION_SYSTEM_PROMPT = """\
You validate one homeowner answer for a structured ADU report requirement.

Output ONLY valid minified JSON matching this schema:
{"accepted":true,"normalized_value":{},"missing_fields":[],"clarification_prompt":null,"display_answer":""}

Rules:
- Do not invent facts.
- Use selected option data as the default.
- Treat free text as an override or elaboration.
- If the answer is vague or does not answer the expected fields, set accepted=false and include one concise clarification_prompt.
- Keep display_answer user-facing, citation-free, and no longer than two sentences.
- normalized_value must only include fields supported by the selected option or free text.
- missing_fields must only include expected fields that remain unanswered.\
"""


def _user_id(user: User) -> str:
    return cast(str, user.id)


def _mutable(instance: object) -> Any:
    return cast(Any, instance)


def sanitize_active_report_visible(
    visible: dict[str, Any] | None,
) -> dict[str, Any] | None:
    sanitized = sanitize_report_visible_fields(visible)
    if sanitized is not None:
        sanitized.pop("requirements", None)
    return sanitized


def sanitize_active_report_context(
    context: dict[str, Any] | None,
) -> dict[str, Any] | None:
    sanitized = sanitize_report_context_fields(context)
    if sanitized is not None:
        sanitized.pop("requirement_answers", None)
        sanitized.pop("requirement_open_items", None)
    return sanitized


def _build_report_trace_metadata(
    *,
    request_id: str,
    route: str,
    project_id: str | None = None,
) -> dict[str, str]:
    metadata = {
        "request_id": request_id,
        "route": route,
    }
    if project_id:
        metadata["project_id"] = project_id
    return metadata


# ── Projects ──────────────────────────────────────────────────────────────────


@router.post("", response_model=ProjectOut, status_code=201)
def create_project(
    body: ProjectCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ProjectOut:
    current_user_id = _user_id(current_user)
    try:
        project = ReportRepository.create_project(db, body, user_id=current_user_id)
        return _project_out(project)
    except Exception:
        logger.exception("Project creation failed for user %s", current_user_id)
        raise HTTPException(
            status_code=500,
            detail=GENERIC_ERROR_MESSAGE,
        )


@router.get("", response_model=list[ProjectOut])
def list_projects(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ProjectOut]:
    current_user_id = _user_id(current_user)
    projects = ReportRepository.list_projects(
        db, user_id=current_user_id, limit=limit, offset=offset
    )
    return [_project_out(p) for p in projects]


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ProjectOut:
    project = _get_owned_project_or_404(db, project_id, _user_id(current_user))
    return _project_out(project)


@router.patch("/{project_id}", response_model=ProjectOut)
def update_project(
    project_id: str,
    body: ProjectUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ProjectOut:
    project = ReportRepository.update_project(
        db, project_id, body, user_id=_user_id(current_user)
    )
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return _project_out(project)


@router.delete("/{project_id}", status_code=204)
def delete_project(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    deleted = ReportRepository.delete_project(
        db, project_id, user_id=_user_id(current_user)
    )
    if not deleted:
        raise HTTPException(status_code=404, detail="Project not found")


# ── Reports ───────────────────────────────────────────────────────────────────


@router.post("/{project_id}/report", response_model=ReportOut, status_code=201)
def create_report(
    project_id: str,
    body: ReportUpdate | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ReportOut:
    current_user_id = _user_id(current_user)
    _get_owned_project_or_404(db, project_id, current_user_id)

    existing = ReportRepository.get_report_by_project(
        db,
        project_id,
        user_id=current_user_id,
    )
    if existing:
        raise HTTPException(
            status_code=409,
            detail="Report already exists for this project. Use PATCH to update.",
        )

    report = ReportRepository.create_report(
        db,
        project_id,
        visible=sanitize_active_report_visible(body.visible) if body else None,
        context=sanitize_active_report_context(body.context) if body else None,
    )
    return _report_out(report)


@router.get("/{project_id}/report", response_model=ReportOut)
def get_report(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ReportOut:
    project = _get_owned_project_or_404(db, project_id, _user_id(current_user))

    report = cast(Report | None, project.report)
    if report is None:
        raise HTTPException(status_code=404, detail="Report not found")

    return _report_out(report)


@router.patch("/{project_id}/report", response_model=ReportOut)
def update_report(
    project_id: str,
    body: ReportUpdate,
    expected_version: int | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ReportOut:
    current_user_id = _user_id(current_user)
    _get_owned_project_or_404(db, project_id, current_user_id)
    try:
        report = ReportRepository.delta_update(
            db,
            project_id,
            ReportUpdate(
                visible=sanitize_active_report_visible(body.visible),
                context=sanitize_active_report_context(body.context),
            ),
            expected_version=expected_version,
            user_id=current_user_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ConflictError:
        current = ReportRepository.get_report_by_project(
            db,
            project_id,
            user_id=current_user_id,
        )
        if current is None:
            raise HTTPException(status_code=404, detail="Report not found")
        raise HTTPException(
            status_code=409,
            detail={
                "error": "version_conflict",
                "message": (
                    f"Report has been updated since you last read it. "
                    f"You sent version {expected_version}, "
                    f"but current version is {current.version}."
                ),
                "current_version": current.version,
                "last_modified": current.last_modified.isoformat()
                if current.last_modified
                else "",
            },
        )
    return _report_out(report)


@router.delete("/{project_id}/report", status_code=204)
def delete_report(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    current_user_id = _user_id(current_user)
    _get_owned_project_or_404(db, project_id, current_user_id)
    deleted = ReportRepository.delete_report(
        db,
        project_id,
        user_id=current_user_id,
    )
    if not deleted:
        raise HTTPException(status_code=404, detail="Report not found")


# ── Guided Report Requirements ──────────────────────────────────────


def get_report_requirement_questions(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> RequirementQuestionsResponse:
    project = _get_owned_project_or_404(db, project_id, _user_id(current_user))
    return RequirementQuestionsResponse(questions=build_requirement_questions(project))


async def answer_report_requirement(
    project_id: str,
    body: RequirementAnswerRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> RequirementAnswerResponse:
    current_user_id = _user_id(current_user)
    project = _get_owned_project_or_404(db, project_id, current_user_id)
    question = get_requirement_question(body.question_id, project)
    if question is None:
        raise HTTPException(status_code=404, detail="Requirement question not found")

    selected_option = get_requirement_option(question, body.selected_option_id)
    if body.selected_option_id and selected_option is None:
        raise HTTPException(status_code=400, detail="Selected option is invalid")
    if not selected_option and not (body.custom_answer or "").strip():
        raise HTTPException(
            status_code=400,
            detail="Select an option or provide a custom answer.",
        )

    logger.info(
        "Guided requirements turn started",
        extra={
            "project_id": project_id,
            "question_id": body.question_id,
            "selected_option_id": body.selected_option_id or "none",
            "has_custom_answer": bool((body.custom_answer or "").strip()),
        },
    )

    validation = await validate_requirement_answer(
        project_id=project_id,
        question=question.model_dump(mode="json"),
        selected_option=selected_option.model_dump(mode="json")
        if selected_option
        else None,
        custom_answer=(body.custom_answer or "").strip(),
        current_user_id=current_user_id,
    )
    source = get_requirement_answer_source(selected_option is not None, body)
    report = persist_requirement_answer(
        db,
        project_id=project_id,
        user_id=current_user_id,
        expected_version=body.expected_version,
        question=question.model_dump(mode="json"),
        selected_option_id=body.selected_option_id,
        validation=validation,
        source=source,
    )

    return RequirementAnswerResponse(
        report=_report_out(report) if report is not None else None,
        preloaded=report is None,
        accepted=validation.accepted,
        status="answered" if validation.accepted else "needs_clarification",
        normalized_value=validation.normalized_value,
        missing_fields=validation.missing_fields,
        clarification_prompt=validation.clarification_prompt,
    )


# ── Report Generation ───────────────────────────────────────────────


@router.post("/{project_id}/report/generate", response_model=ReportOut)
def generate_structured_report(
    project_id: str,
    body: GenerateStructuredReportRequest | None = None,
    expected_version: int | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ReportOut:
    current_user_id = _user_id(current_user)
    logger.info(
        "[report-generation] request received",
        extra={
            "tag": REPORT_GENERATION_LOG_TAG,
            "stage": "generate_request",
            "project_id": project_id,
            "messages_in_body": len(body.messages) if body else 0,
        },
    )
    project = _get_owned_project_or_404(db, project_id, current_user_id)
    existing = ReportRepository.get_report_by_project(
        db,
        project_id,
        user_id=current_user_id,
    )
    source_project_version = int(getattr(project, "report_input_version", 1) or 1)

    composed_visible, composed_context = compose_report_from_project(
        project,
    )

    visible = sanitize_report_visible_fields(composed_visible)
    if visible is None:
        visible = {}
    context = sanitize_report_context_fields(composed_context)

    if existing:
        existing_version = int(cast(Any, existing.version) or 0)
        if expected_version is not None and existing_version > expected_version:
            raise HTTPException(
                status_code=409,
                detail={
                    "error": "version_conflict",
                    "current_version": existing_version,
                },
            )
        try:
            report = ReportRepository.replace_generated_report(
                db,
                project_id,
                ReportUpdate(visible=visible, context=context),
                source_project_version=source_project_version,
                expected_report_version=expected_version,
                user_id=current_user_id,
            )
        except ConflictError as exc:
            raise HTTPException(
                status_code=409,
                detail={"error": "project_changed", "message": str(exc)},
            ) from exc
        save_mode = "delta_update"
    else:
        report = ReportRepository.create_report(
            db,
            project_id,
            visible=visible,
            context=context,
        )
        save_mode = "create"

    logger.info(
        "[report-generation] report saved",
        extra={
            "tag": REPORT_GENERATION_LOG_TAG,
            "stage": "report_saved",
            "project_id": project_id,
            "save_mode": save_mode,
            "report_version": getattr(report, "version", None),
            "source_project_version": source_project_version,
        },
    )

    return _report_out(report)


async def validate_requirement_answer(
    *,
    project_id: str,
    question: dict[str, Any],
    selected_option: dict[str, Any] | None,
    custom_answer: str,
    current_user_id: str,
) -> RequirementValidationOutput:
    answer_source = _guided_requirement_answer_source(
        selected_option is not None,
        custom_answer,
    )

    if not custom_answer:
        validation = build_selected_requirement_validation(question, selected_option)
        log_guided_requirements_turn_usage(
            project_id=project_id,
            question_id=str(question["id"]),
            answer_source=answer_source,
            status="answered" if validation.accepted else "needs_clarification",
            llm_used=False,
            reason="selected_option_only",
        )
        return validation

    api_key = get_openrouter_key()
    if not api_key:
        logger.warning(
            "Skipping requirement answer validation for project %s: OPENROUTER_API_KEY not set.",
            project_id,
        )
        validation = build_fallback_requirement_validation(
            question,
            selected_option,
            custom_answer,
        )
        log_guided_requirements_turn_usage(
            project_id=project_id,
            question_id=str(question["id"]),
            answer_source=answer_source,
            status="answered" if validation.accepted else "needs_clarification",
            llm_used=False,
            reason="api_key_missing",
        )
        return validation

    try:
        with usage_accumulator_scope() as accumulator:
            usage_baseline = accumulator.breakdown_count()
            async with reserve_llm_budget(
                api_key_hash=ensure_user_api_key(current_user_id),
                route="reports",
                fallback_cost_micros=3_000,
                model=REPORT_MODEL,
            ) as reservation:
                validation, usage = await _run_structured_report_completion(
                    system_instruction=REQUIREMENT_VALIDATION_SYSTEM_PROMPT,
                    user_content=build_requirement_validation_input(
                        question,
                        selected_option,
                        custom_answer,
                    ),
                    output_model=RequirementValidationOutput,
                    api_key=api_key,
                    request_id=reservation.request_id,
                    route="reports",
                    workflow_name="Requirement Answer Validator",
                    project_id=project_id,
                )
                record_litellm_usage(
                    model=REPORT_MODEL,
                    usage=usage,
                    route="reports",
                    source="reports.validate_requirement_answer",
                )
                log_guided_requirements_turn_usage(
                    project_id=project_id,
                    question_id=str(question["id"]),
                    answer_source=answer_source,
                    status="answered" if validation.accepted else "needs_clarification",
                    llm_used=True,
                    since=usage_baseline,
                )
                return validation
    except Exception:
        logger.exception(
            "Requirement answer validation failed for project %s; using fallback.",
            project_id,
        )
        validation = build_fallback_requirement_validation(
            question,
            selected_option,
            custom_answer,
        )
        log_guided_requirements_turn_usage(
            project_id=project_id,
            question_id=str(question["id"]),
            answer_source=answer_source,
            status="answered" if validation.accepted else "needs_clarification",
            llm_used=False,
            reason="validation_error_fallback",
        )
        return validation


def _guided_requirement_answer_source(
    has_selected_option: bool,
    custom_answer: str,
) -> str:
    has_custom_answer = bool(custom_answer.strip())
    if has_selected_option and has_custom_answer:
        return "mixed"
    if has_custom_answer:
        return "free_text"
    return "selected_option"


def build_selected_requirement_validation(
    question: dict[str, Any],
    selected_option: dict[str, Any] | None,
) -> RequirementValidationOutput:
    if selected_option is None:
        return RequirementValidationOutput(
            accepted=False,
            missing_fields=list(question.get("expected_fields") or []),
            clarification_prompt="Tell me a little more so I can save this requirement.",
        )
    return RequirementValidationOutput(
        accepted=True,
        normalized_value=dict(selected_option.get("normalized_value") or {}),
        missing_fields=[],
        clarification_prompt=None,
        display_answer=(
            f"{selected_option.get('label')}: {selected_option.get('description')}"
        ),
    )


def build_fallback_requirement_validation(
    question: dict[str, Any],
    selected_option: dict[str, Any] | None,
    custom_answer: str,
) -> RequirementValidationOutput:
    normalized_value = dict((selected_option or {}).get("normalized_value") or {})
    normalized_value["custom_answer"] = custom_answer
    missing_fields = (
        [] if len(custom_answer.split()) >= 3 else question["expected_fields"]
    )
    return RequirementValidationOutput(
        accepted=not missing_fields,
        normalized_value=normalized_value,
        missing_fields=missing_fields,
        clarification_prompt=(
            "Can you add a bit more detail so I can save this requirement?"
            if missing_fields
            else None
        ),
        display_answer=custom_answer,
    )


def build_requirement_validation_input(
    question: dict[str, Any],
    selected_option: dict[str, Any] | None,
    custom_answer: str,
) -> str:
    return json.dumps(
        {
            "question": {
                "id": question["id"],
                "section": question["section"],
                "prompt": question["prompt"],
                "expected_fields": question["expected_fields"],
            },
            "selected_option": selected_option,
            "custom_answer": custom_answer,
        },
        separators=(",", ":"),
    )


def persist_requirement_answer(
    db: Session,
    *,
    project_id: str,
    user_id: str,
    expected_version: int | None,
    question: dict[str, Any],
    selected_option_id: str | None,
    validation: RequirementValidationOutput,
    source: str,
) -> Report | None:
    existing = ReportRepository.get_report_by_project(
        db,
        project_id,
        user_id=user_id,
    )
    if existing is None:
        raise HTTPException(
            status_code=409,
            detail="Generate the project report before answering report requirements.",
        )

    current_visible = dict(getattr(existing, "visible", None) or {})
    current_context = dict(getattr(existing, "context", None) or {})

    visible_update = build_requirement_visible_update(
        current_visible,
        question,
        selected_option_id,
        validation,
    )
    context_update = build_requirement_context_update(
        current_context,
        question,
        validation,
        source,
    )
    sanitized_visible = sanitize_report_visible_fields(visible_update) or {}
    sanitized_context = sanitize_report_context_fields(context_update) or {}

    try:
        return ReportRepository.delta_update(
            db,
            project_id,
            ReportUpdate(visible=sanitized_visible, context=sanitized_context),
            expected_version=expected_version,
            user_id=user_id,
        )
    except ConflictError:
        current = ReportRepository.get_report_by_project(
            db,
            project_id,
            user_id=user_id,
        )
        raise HTTPException(
            status_code=409,
            detail={
                "error": "version_conflict",
                "current_version": getattr(current, "version", None),
            },
        )


def build_requirement_visible_update(
    current_visible: dict[str, Any],
    question: dict[str, Any],
    selected_option_id: str | None,
    validation: RequirementValidationOutput,
) -> dict[str, Any]:
    merged_requirements = merge_visible_requirement(
        list(current_visible.get("requirements") or []),
        question=cast(Any, SimpleQuestion(question)),
        answer=validation.display_answer,
        selected_option_id=selected_option_id,
        needs_review=not validation.accepted,
    )
    return {"requirements": merged_requirements}


def build_requirement_context_update(
    current_context: dict[str, Any],
    question: dict[str, Any],
    validation: RequirementValidationOutput,
    source: str,
) -> dict[str, Any]:
    simple_question = cast(Any, SimpleQuestion(question))
    requirement_answers = merge_context_requirement_answer(
        list(current_context.get("requirement_answers") or []),
        question=simple_question,
        normalized_value=validation.normalized_value,
        missing_fields=validation.missing_fields,
        source=source,
    )
    requirement_open_items = merge_requirement_open_items(
        list(current_context.get("requirement_open_items") or []),
        question=simple_question,
        missing_fields=validation.missing_fields,
    )
    return {
        "requirement_answers": requirement_answers,
        "requirement_open_items": requirement_open_items,
    }


class SimpleQuestion:
    def __init__(self, question: dict[str, Any]) -> None:
        self.id = question["id"]
        self.title = question["title"]
        self.prompt = question["prompt"]
        self.section = question["section"]


def get_requirement_answer_source(
    has_selected_option: bool,
    body: RequirementAnswerRequest,
) -> str:
    has_custom_answer = bool((body.custom_answer or "").strip())
    if has_selected_option and has_custom_answer:
        return "mixed"
    if has_custom_answer:
        return "free_text"
    return "selected_option"


def ensure_visible_report_recommendations(
    project: Project,
    visible: dict[str, Any] | None,
) -> dict[str, Any]:
    next_visible = dict(visible or {})
    next_visible["recommendations"] = normalize_report_recommendations(
        project,
        next_visible.get("recommendations"),
    )
    return next_visible


def normalize_report_recommendations(project: Project, value: Any) -> str:
    if not isinstance(value, str) or not value.strip():
        return build_recommendations_fallback(project)

    intro, bullet_items = extract_recommendation_parts(value)
    if len(bullet_items) < 3:
        return build_recommendations_fallback(project)

    normalized_intro = intro or build_recommendations_intro(project)
    normalized_bullets = bullet_items[:6]
    return "\n\n".join(
        [
            normalized_intro,
            *[f"- {bullet}" for bullet in normalized_bullets],
        ]
    )


def extract_recommendation_parts(text: str) -> tuple[str, list[str]]:
    intro_lines: list[str] = []
    bullet_items: list[str] = []

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        bullet_match = MARKDOWN_BULLET_RE.match(line) or MARKDOWN_NUMBERED_RE.match(
            line
        )
        if bullet_match:
            bullet_text = bullet_match.group(1).strip()
            if bullet_text:
                bullet_items.append(bullet_text)
            continue

        if bullet_items:
            bullet_items[-1] = f"{bullet_items[-1]} {line}".strip()
            continue

        intro_lines.append(line)

    return " ".join(intro_lines).strip(), bullet_items


def build_recommendations_fallback(project: Project) -> str:
    bullets = [
        build_design_recommendation(project),
        build_budget_recommendation(project),
        build_site_review_recommendation(project),
        build_coordination_recommendation(project),
        build_use_case_recommendation(project),
    ]
    return "\n\n".join(
        [
            build_recommendations_intro(project),
            *[f"- {bullet}" for bullet in bullets],
        ]
    )


def build_recommendations_intro(project: Project) -> str:
    location = getattr(project, "address", None) or "this property"
    descriptor = build_project_descriptor(project)
    return (
        f"Based on the current feasibility work for {location}, the next steps below "
        f"will help move {descriptor} into a permit-ready plan with fewer cost and "
        "site-surprise risks."
    )


def build_project_descriptor(project: Project) -> str:
    adu_sqft = getattr(project, "adu_sqft", None)
    adu_type = format_recommendation_adu_type(getattr(project, "adu_type", None))
    if adu_sqft and adu_type:
        return f"your planned {int(adu_sqft):,d} sq ft {adu_type}"
    if adu_sqft:
        return f"your planned {int(adu_sqft):,d} sq ft ADU"
    if adu_type:
        return f"your planned {adu_type}"
    return "the ADU project"


def format_recommendation_adu_type(adu_type: str | None) -> str | None:
    if not adu_type:
        return None
    return f"{adu_type.replace('_', ' ')} ADU"


def build_design_recommendation(project: Project) -> str:
    descriptor = build_project_descriptor(project)
    yard_zone = getattr(project, "current_yard_zone", None)
    clearance_summary = format_adu_clearances(getattr(project, "adu_clearances", None))
    siting_details: list[str] = []
    if yard_zone:
        siting_details.append(f"the current {yard_zone.lower()} yard placement")
    if clearance_summary:
        siting_details.append(f"the identified clearances of {clearance_summary}")
    siting_phrase = ""
    if siting_details:
        siting_phrase = " while preserving " + " and ".join(siting_details)
    return (
        f"Translate {descriptor} into a permit-ready design package with a site plan, "
        f"elevations, and code notes that match the current feasibility assumptions"
        f"{siting_phrase}."
    )


def build_budget_recommendation(project: Project) -> str:
    finance_state = (
        cast(dict[str, Any] | None, getattr(project, "finance_state", None)) or {}
    )
    has_started_estimate = bool(
        finance_state.get("base_estimate_range")
        or finance_state.get("complication_adjusted_range")
    )
    if has_started_estimate:
        return (
            "Use the current calculator estimate as the working budget, then price-check "
            "permit, utility, and site-specific items that may still sit outside the "
            "included add-ons before you finalize design decisions."
        )
    return (
        "Run or refresh the calculator estimate before locking scope so permit, utility, "
        "and construction decisions are grounded in a current planning budget rather than "
        "assumptions carried over from an earlier concept."
    )


def build_site_review_recommendation(project: Project) -> str:
    review_items: list[str] = []
    fire_hazard_severity = getattr(project, "fire_hazard_severity", None)
    blocker_types = getattr(project, "blocker_types", None) or []
    if is_unknown_fire_hazard(fire_hazard_severity):
        review_items.append("confirming fire hazard status")
    elif fire_hazard_severity:
        review_items.append(f"{fire_hazard_severity.lower()} fire-zone requirements")
    if blocker_types:
        review_items.append(", ".join(str(blocker) for blocker in blocker_types))

    if review_items:
        review_subject = " and ".join(review_items)
        return (
            f"Complete a site-specific review focused on {review_subject}, so any extra "
            "scope tied to access, safety, demolition, or utility upgrades is identified "
            "before it creates churn in drawings or budget."
        )
    return (
        "Complete a site-specific review covering access, grading, utility tie-ins, and "
        "existing conditions so hidden scope is surfaced before final permit drawings and "
        "contractor pricing begin."
    )


def is_unknown_fire_hazard(value: object) -> bool:
    return str(value or "").strip().lower() == UNKNOWN_FIRE_HAZARD_SEVERITY.lower()


def build_coordination_recommendation(project: Project) -> str:
    county = getattr(project, "county", None)
    county_phrase = f" with {county}" if county else ""
    return (
        "Coordinate early with an ADU-savvy designer, permit expediter, or local planner"
        f"{county_phrase} to confirm submittal expectations, utility coordination, and "
        "the sequence of approvals before you spend money on final construction documents."
    )


def build_use_case_recommendation(project: Project) -> str:
    primary_use = getattr(project, "primary_use", None)
    if primary_use:
        return (
            f"Keep the layout, storage, privacy, and finish decisions aligned with the "
            f"stated primary use of {primary_use}, so the final design supports how the "
            "ADU will actually be occupied and avoids expensive late-stage redesign."
        )
    return (
        "Decide now which layout, privacy, storage, and finish priorities are truly non-negotiable, "
        "so the design team can make tradeoffs against a clear operating goal instead of a generic brief."
    )


# ── Drafts ─────────────────────────────────────────────────────────────────


@router.get("/{project_id}/draft", response_model=DraftOut)
def get_draft(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DraftOut:
    _get_owned_project_or_404(db, project_id, _user_id(current_user))
    draft = ReportRepository.get_draft_by_project(db, project_id)
    if not draft:
        raise HTTPException(status_code=404, detail="Draft not found")
    return DraftOut.model_validate(draft)


@router.put("/{project_id}/draft", response_model=DraftOut)
def upsert_draft(
    project_id: str,
    body: DraftUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DraftOut:
    current_user_id = _user_id(current_user)
    _get_owned_project_or_404(db, project_id, current_user_id)

    try:
        draft = ReportRepository.upsert_draft(
            db,
            project_id,
            seller_id=current_user_id,
            draft_payload=body.draft_payload,
            field_meta=body.field_meta,
        )
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc))

    return DraftOut.model_validate(draft)


@router.delete("/{project_id}/draft", status_code=204)
def delete_draft(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    _get_owned_project_or_404(db, project_id, _user_id(current_user))
    deleted = ReportRepository.delete_draft(db, project_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Draft not found")


# ── Publish / Unpublish / Archive ──────────────────────────────────────────


@router.post("/{project_id}/publish", response_model=ProjectOut)
def publish_project(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ProjectOut:
    """Copy finalized draft data into listings table and set project.status='published'."""
    current_user_id = _user_id(current_user)
    project = _get_owned_project_or_404(db, project_id, current_user_id)

    draft = ReportRepository.get_draft_by_project(db, project_id)
    if not draft:
        raise HTTPException(status_code=400, detail="No draft to publish")

    payload = dict(cast(Any, draft.draft_payload) or {})

    existing_listing = (
        db.query(Listing).filter(Listing.project_id == project_id).first()
    )

    if existing_listing:
        _apply_payload_to_listing(existing_listing, payload)
        _mutable(existing_listing).updated_at = datetime.now(timezone.utc)
    else:
        listing = _mutable(Listing())
        listing.seller_id = current_user_id
        listing.project_id = project_id
        _apply_payload_to_listing(listing, payload)
        db.add(listing)

    project_mut = _mutable(project)
    project_mut.status = "published"
    project_mut.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(project)
    return _project_out(project)


@router.post("/{project_id}/unpublish", response_model=ProjectOut)
def unpublish_project(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ProjectOut:
    """Remove from marketplace, revert to project status."""
    project = _get_owned_project_or_404(db, project_id, _user_id(current_user))

    db.query(Listing).filter(Listing.project_id == project_id).delete()

    project_mut = _mutable(project)
    project_mut.status = "project"
    project_mut.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(project)
    return _project_out(project)


@router.post("/{project_id}/archive", response_model=ProjectOut)
def archive_project(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ProjectOut:
    """Archive: remove from marketplace and set status to archived."""
    project = _get_owned_project_or_404(db, project_id, _user_id(current_user))

    db.query(Listing).filter(Listing.project_id == project_id).delete()

    project_mut = _mutable(project)
    project_mut.status = "archived"
    project_mut.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(project)
    return _project_out(project)


@router.post("/{project_id}/unarchive", response_model=ProjectOut)
def unarchive_project(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ProjectOut:
    """Unarchive: revert to project status."""
    project = _get_owned_project_or_404(db, project_id, _user_id(current_user))
    project_status = cast(str | None, project.status)
    if project_status != "archived":
        raise HTTPException(status_code=400, detail="Project is not archived")

    has_draft = ReportRepository.get_draft_by_project(db, project_id) is not None
    project_mut = _mutable(project)
    if has_draft:
        project_mut.status = "project"
    else:
        project_mut.status = "project"
    project_mut.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(project)
    return _project_out(project)


# ── Report-to-Draft Conversion ────────────────────────────────────────────


@util_router.post("/parse-report-to-listing", response_model=ParsedListingDraftResponse)
async def parse_report_to_listing(
    req: ParseReportRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Extract property facts from a markdown report and create/update a draft.
    Writes to the drafts table (not listings) and sets project.status='project'.
    """
    api_key = get_openrouter_key()
    if not api_key:
        raise HTTPException(status_code=500, detail="OpenRouter API key missing")

    try:
        with usage_accumulator_scope():
            async with reserve_llm_budget(
                api_key_hash=ensure_user_api_key(_user_id(current_user)),
                route="reports",
                fallback_cost_micros=15_000,
                model=REPORT_MODEL,
            ) as reservation:
                parsed, usage = await _run_structured_report_completion(
                    system_instruction=PARSE_SYSTEM_PROMPT,
                    user_content=req.report_markdown,
                    output_model=ParsedListingData,
                    api_key=api_key,
                    request_id=reservation.request_id,
                    route="reports",
                    workflow_name="Report Parser",
                    project_id=req.project_id,
                )
                record_litellm_usage(
                    model=REPORT_MODEL,
                    usage=usage,
                    route="reports",
                    source="reports.parse_report_to_listing",
                )

        project = None
        report = None
        if req.project_id:
            current_user_id = _user_id(current_user)
            project = _get_owned_project_or_404(db, req.project_id, current_user_id)
            report = ReportRepository.get_report_by_project(
                db,
                req.project_id,
                user_id=current_user_id,
            )

        listing, field_meta = _build_listing_draft_response(
            parsed=parsed,
            seller=current_user,
            project=project,
            report=report,
        )

        # Look for existing draft (not listing) for this project
        existing_draft = None
        if req.project_id:
            existing_draft = ReportRepository.get_draft_by_project(db, req.project_id)

        if existing_draft:
            try:
                current_listing = ListingDraftData(
                    **(cast(Any, existing_draft.draft_payload) or {})
                )
            except Exception:
                logger.warning(
                    "Could not parse existing draft payload for project %s; treating as fresh create",
                    req.project_id,
                )
                existing_draft = None

        if existing_draft:
            current_meta = dict(cast(Any, existing_draft.field_meta) or {})

            proposed_listing, proposed_meta, changes = _build_merge_response(
                current_listing=current_listing,
                current_meta=current_meta,
                incoming_listing=listing,
                incoming_meta=field_meta,
            )

            proposed_meta = _normalize_meta_dict(proposed_meta)

            logger.info(
                "Merge for project %s: %d total changes (%s)",
                req.project_id,
                len(changes),
                ", ".join(f"{c.type}:{c.field}" for c in changes[:10]),
            )

            return ParsedListingDraftResponse(
                action="merge",
                draftId=cast(str | None, existing_draft.id),
                projectId=req.project_id,
                listing=current_listing,
                fieldMeta=_normalize_meta_dict(current_meta),
                proposedListing=proposed_listing,
                proposedFieldMeta=proposed_meta,
                changes=changes,
            )

        # No existing draft — create a new one
        normalized_meta = _normalize_meta_dict(field_meta)
        if req.project_id:
            new_draft = ReportRepository.create_draft(
                db,
                req.project_id,
                seller_id=_user_id(current_user),
                draft_payload=listing.model_dump(),
                field_meta=normalized_meta,
            )
            return ParsedListingDraftResponse(
                action="create",
                draftId=cast(str | None, new_draft.id),
                projectId=req.project_id,
                listing=listing,
                fieldMeta=normalized_meta,
            )

        return ParsedListingDraftResponse(
            action="create",
            listing=listing,
            fieldMeta=normalized_meta,
        )

    except HTTPException:
        raise
    except Exception:
        logger.exception("Report parsing failed")
        raise HTTPException(
            status_code=500,
            detail=GENERIC_ERROR_MESSAGE,
        )


# ── Helpers ───────────────────────────────────────────────────────────────────


def _apply_payload_to_listing(listing: Listing, payload: dict) -> None:
    """Map draft_payload fields to Listing model columns for publishing."""
    listing_mut = _mutable(listing)
    listing_mut.address = payload.get("address") or listing.address
    listing_mut.city = payload.get("city") or listing.city
    listing_mut.state = payload.get("state") or listing.state
    listing_mut.zip_code = payload.get("zipCode") or listing.zip_code
    listing_mut.lat = payload.get("lat") or listing.lat
    listing_mut.lng = payload.get("lng") or listing.lng
    listing_mut.bedrooms = payload.get("bedrooms") or listing.bedrooms
    listing_mut.bathrooms = payload.get("bathrooms") or listing.bathrooms
    listing_mut.sqft = payload.get("sqft") or listing.sqft
    listing_mut.monthly_rent = payload.get("monthlyRent") or listing.monthly_rent
    listing_mut.adu_type = payload.get("aduType") or listing.adu_type
    listing_mut.permit_status = payload.get("permitStatus") or listing.permit_status
    listing_mut.hero_image = payload.get("heroImage") or listing.hero_image
    listing_mut.description = payload.get("description") or listing.description
    listing_mut.seo_title = payload.get("seoTitle") or listing.seo_title
    listing_mut.image_gallery = payload.get("imageGallery") or listing.image_gallery
    listing_mut.amenities = payload.get("amenities") or listing.amenities
    listing_mut.utilities_included = (
        payload.get("utilitiesIncluded") or listing.utilities_included
    )
    listing_mut.lease_term = payload.get("leaseTerm") or listing.lease_term
    listing_mut.pet_policy = payload.get("petPolicy") or listing.pet_policy
    listing_mut.furnished = payload.get("furnished") or listing.furnished


async def _run_structured_report_completion(
    *,
    system_instruction: str,
    user_content: str,
    output_model: type[StructuredOutputT],
    api_key: str,
    request_id: str,
    route: str,
    workflow_name: str,
    project_id: str | None = None,
) -> tuple[StructuredOutputT, Any]:
    metadata = _build_report_trace_metadata(
        request_id=request_id,
        route=route,
        project_id=project_id,
    )
    logger.info("Running report completion: %s", workflow_name, extra=metadata)

    response = await acompletion_resilient(
        tier=LONG,
        model=LITELLM_REPORT_MODEL,
        api_key=api_key,
        messages=[
            {"role": "system", "content": system_instruction},
            {"role": "user", "content": user_content},
        ],
        response_format={"type": "json_object"},
        **reasoning_kwargs(),
    )
    parsed_output = _parse_structured_output(
        _extract_message_text(response),
        output_model,
    )
    return parsed_output, getattr(response, "usage", None)


def _parse_structured_output(
    raw_response: str,
    output_model: type[StructuredOutputT],
) -> StructuredOutputT:
    cleaned = raw_response.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:].strip()

    payload = json.loads(cleaned)
    if (
        output_model is StructuredReportOutput
        and isinstance(payload, dict)
        and "context" not in payload
    ):
        logger.warning(
            "Structured report output missing context; defaulting to an empty context block."
        )
        payload = {**payload, "context": {}}

    return output_model.model_validate(payload)


def _extract_message_text(response: Any) -> str:
    choices = getattr(response, "choices", None) or []
    if not choices:
        return ""

    message = getattr(choices[0], "message", None)
    content = getattr(message, "content", "")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(_extract_content_part_text(part) for part in content)
    return str(content or "")


def _extract_content_part_text(part: Any) -> str:
    if isinstance(part, str):
        return part
    if isinstance(part, dict):
        text = part.get("text")
        if isinstance(text, str):
            return text
        return ""
    text = getattr(part, "text", None)
    if isinstance(text, str):
        return text
    return ""


def _build_report_input(project: Project, body: GenerateStructuredReportRequest) -> str:
    parts: list[str] = []
    property_context = build_property_report_context(project)
    if property_context:
        parts.append(property_context)

    finance_context = build_finance_report_context(project)
    if finance_context:
        parts.append(finance_context)

    conversation_context = build_report_conversation_context(body)
    if conversation_context:
        parts.append(conversation_context)

    return "\n\n".join(parts) if parts else "Generate a generic ADU feasibility report."


def build_property_report_context(project: Project) -> str:
    ctx_lines: list[str] = []
    if project.address:
        ctx_lines.append(f"- Address: {project.address}")
    if project.property_area_sqft:
        ctx_lines.append(f"- Property Area: {int(project.property_area_sqft):,d} sq ft")
    if project.buildable_area_sqft:
        ctx_lines.append(
            f"- Buildable Area: {int(project.buildable_area_sqft):,d} sq ft"
        )
    if project.setback_ft:
        ctx_lines.append(f"- Setback: {int(project.setback_ft)} ft")
    if project.max_adu_sqft:
        ctx_lines.append(f"- Max ADU Allowed: {int(project.max_adu_sqft):,d} sq ft")
    if project.adu_sqft:
        ctx_lines.append(f"- Planned ADU Size: {int(project.adu_sqft):,d} sq ft")
    adu_width_ft = getattr(project, "adu_width_ft", None)
    adu_length_ft = getattr(project, "adu_length_ft", None)
    adu_shape = getattr(project, "adu_shape", None)
    if adu_width_ft is not None and adu_length_ft is not None:
        label = footprint_dimensions_label_for_shape(adu_shape)
        ctx_lines.append(f"- {label}: {adu_width_ft:g} x {adu_length_ft:g} ft")
    if project.adu_type:
        ctx_lines.append(f"- ADU Type: {project.adu_type.replace('_', ' ').title()}")
    if project.adu_shape:
        ctx_lines.append(f"- ADU Shape: {project.adu_shape.replace('_', ' ').title()}")
    if project.primary_use:
        ctx_lines.append(f"- Primary Use: {project.primary_use}")
    if project.current_yard_zone:
        ctx_lines.append(f"- Current Yard Zone: {project.current_yard_zone}")
    clearance_summary = format_adu_clearances(project.adu_clearances)
    if clearance_summary:
        ctx_lines.append(f"- ADU Clearances: {clearance_summary}")
    if project.blocker_types:
        ctx_lines.append(f"- Potential Blockers: {', '.join(project.blocker_types)}")
    if not ctx_lines:
        return ""
    return "**Property Analysis Data:**\n" + "\n".join(ctx_lines)


def build_finance_report_context(project: Project) -> str:
    return build_financial_report_context(
        cast(dict[str, Any] | None, project.finance_state)
    )


def build_report_conversation_context(body: GenerateStructuredReportRequest) -> str:
    if not body.messages:
        return ""
    conversation = "\n".join(
        f"{'User' if message.role == 'user' else 'Advisor'}: "
        f"{sanitize_report_message_content(message.role, message.content)}"
        for message in body.messages[-30:]
    )
    return f"**Advisor Conversation:**\n{conversation}"


def sanitize_report_message_content(role: str, content: str) -> str:
    if role == "assistant":
        return sanitize_report_text(content)
    return content


def _get_owned_project_or_404(db: Session, project_id: str, user_id: str) -> Project:
    project = ReportRepository.get_project(db, project_id, user_id=user_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def _project_out(project: Project) -> ProjectOut:
    out = ProjectOut.model_validate(project)
    out.has_report = project.report is not None
    if project.report is None:
        out.report_status = "not_generated"
    elif int(project.report.source_project_version or 1) != int(
        project.report_input_version or 1
    ):
        out.report_status = "outdated"
    else:
        out.report_status = "current"
    out.has_draft = project.draft is not None
    draft = cast(Any, project.draft)
    if draft and draft.draft_payload:
        payload = cast(dict[str, Any], draft.draft_payload)
        out.draft_bedrooms = payload.get("bedrooms")
        out.draft_bathrooms = payload.get("bathrooms")
        out.draft_monthly_rent = payload.get("monthlyRent")
        out.draft_hero_image = payload.get("heroImage") or None
    return out


def _report_out(report: Report) -> ReportOut:
    report_out = ReportOut.model_validate(report)
    report_out.visible.requirements = []
    report_out.context.requirement_answers = []
    report_out.context.requirement_open_items = []
    return report_out


def _normalize_meta_dict(meta: dict) -> dict:
    """Ensure every value in a field_meta dict is a plain dict (not a Pydantic model)."""
    out = {}
    for k, v in meta.items():
        if hasattr(v, "model_dump"):
            out[k] = v.model_dump()
        elif isinstance(v, dict):
            out[k] = v
        else:
            out[k] = {"source": "agent", "status": "auto-filled"}
    return out


def _auto_meta(
    source: Literal["wizard", "user", "agent", "calculated"] = "agent",
) -> ListingFieldMeta:
    return ListingFieldMeta(source=source, status="auto-filled")


def _normalize(value: str | None) -> str:
    return " ".join((value or "").split()).strip()


def _is_filled(value) -> bool:
    if value is None or value == "":
        return False
    if isinstance(value, list):
        return len(value) > 0
    return True


def _split_address(full_address: str | None) -> tuple[str, str, str, str]:
    normalized = _normalize(full_address)
    if not normalized:
        return "", "", "CA", ""
    parts = [part.strip() for part in normalized.split(",") if part.strip()]
    street = parts[0] if parts else ""
    city = parts[1] if len(parts) > 1 else ""
    state_zip = parts[2] if len(parts) > 2 else ""
    tokens = state_zip.split()
    state = tokens[0] if tokens else "CA"
    zip_code = tokens[1] if len(tokens) > 1 else ""
    return street, city, state, zip_code


def _normalize_adu_type(value: str | None) -> str | None:
    normalized = _normalize(value).lower().replace("-", "_").replace(" ", "_")
    if "jadu" in normalized or "junior" in normalized:
        return "junior_adu"
    if "garage" in normalized and "conversion" in normalized:
        return "garage_conversion"
    if "above" in normalized and "garage" in normalized:
        return "above_garage"
    allowed = {
        "detached",
        "attached",
        "garage_conversion",
        "junior_adu",
        "above_garage",
        "basement",
    }
    return normalized if normalized in allowed else None


def _build_headline(address: str, city: str, adu_type: str | None) -> str:
    labels = {
        "detached": "Detached ADU",
        "attached": "Attached ADU",
        "garage_conversion": "Garage Conversion ADU",
        "junior_adu": "Junior ADU",
        "above_garage": "Above-Garage ADU",
        "basement": "Basement ADU",
    }
    location = city or address or "California"
    return f"{labels.get(adu_type or '', 'Detached ADU')} Draft in {location}"


def _join_unique_parts(*parts: str | None) -> str:
    seen: list[str] = []
    for part in parts:
        normalized = _normalize(part)
        if normalized and normalized not in seen:
            seen.append(normalized)
    return "\n\n".join(seen)


def _is_empty_for_merge(value) -> bool:
    if value is None or value == "":
        return True
    if isinstance(value, list):
        return len(value) == 0
    return False


def _normalize_for_compare(value) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, list):
        return "|".join(
            sorted(_normalize(str(item)) for item in value if _normalize(str(item)))
        )
    return _normalize(str(value))


def _merge_appendable_value(current_value, incoming_value):
    if isinstance(current_value, list) and isinstance(incoming_value, list):
        merged: list[str] = []
        for item in current_value + incoming_value:
            normalized = _normalize(str(item))
            if normalized and normalized not in merged:
                merged.append(normalized)
        return merged
    current_text = _normalize(str(current_value))
    incoming_text = _normalize(str(incoming_value))
    return _join_unique_parts(current_text, incoming_text)


def _build_merge_response(
    *,
    current_listing: ListingDraftData,
    current_meta: dict,
    incoming_listing: ListingDraftData,
    incoming_meta: dict[str, ListingFieldMeta],
):
    """Compare current draft with incoming AI-parsed listing and build a
    proposed version that includes all incoming information.

    Returns (proposed_listing, proposed_meta, changes[]) where changes
    is a list of MergeChange dicts classifying each field update as
    'new' (was empty), 'appended' (list/text extended), or 'conflict'
    (both sides have different values).

    Nothing is auto-stitched — the caller decides whether to apply the
    proposed listing based on user acceptance.
    """
    appendable_fields = {"investorMetrics", "neighborhoodInfo", "amenities"}
    proposed = current_listing.model_copy(deep=True)
    proposed_meta = dict(current_meta or {})
    changes: list[MergeChange] = []

    incoming_dump = incoming_listing.model_dump()
    for key, incoming_value in incoming_dump.items():
        if key in {
            "id",
            "status",
            "createdAt",
            "updatedAt",
            "sellerId",
            "sellerName",
            "projectId",
        }:
            continue
        if key not in incoming_meta:
            continue
        if _is_empty_for_merge(incoming_value):
            continue

        current_value = getattr(proposed, key)
        meta_val = incoming_meta[key]
        meta_dict = (
            meta_val.model_dump() if hasattr(meta_val, "model_dump") else meta_val
        )

        if _is_empty_for_merge(current_value):
            setattr(proposed, key, incoming_value)
            proposed_meta[key] = meta_dict
            changes.append(
                MergeChange(
                    field=key,
                    type="new",
                    currentValue="",
                    incomingValue=_display_value(incoming_value),
                )
            )
            continue

        # Keep "What's Special" (description) anchored to the latest report output
        # unless the user manually edited it. This prevents unbounded accumulation
        # across report regenerations.
        if key == "description":
            if _normalize_for_compare(current_value) == _normalize_for_compare(
                incoming_value
            ):
                continue
            if _is_user_edited_meta(current_meta.get(key)):
                setattr(proposed, key, incoming_value)
                proposed_meta[key] = meta_dict
                changes.append(
                    MergeChange(
                        field=key,
                        type="conflict",
                        currentValue=_display_value(current_value),
                        incomingValue=_display_value(incoming_value),
                    )
                )
            else:
                setattr(proposed, key, incoming_value)
                proposed_meta[key] = meta_dict
                changes.append(
                    MergeChange(
                        field=key,
                        type="appended",
                        currentValue=_display_value(current_value),
                        incomingValue=_display_value(incoming_value),
                    )
                )
            continue

        if key in appendable_fields:
            merged_value = _merge_appendable_value(current_value, incoming_value)
            if _normalize_for_compare(merged_value) != _normalize_for_compare(
                current_value
            ):
                setattr(proposed, key, merged_value)
                proposed_meta[key] = meta_dict
                changes.append(
                    MergeChange(
                        field=key,
                        type="appended",
                        currentValue=_display_value(current_value),
                        incomingValue=_display_value(merged_value),
                    )
                )
            continue

        if _normalize_for_compare(current_value) == _normalize_for_compare(
            incoming_value
        ):
            continue

        setattr(proposed, key, incoming_value)
        proposed_meta[key] = meta_dict
        changes.append(
            MergeChange(
                field=key,
                type="conflict",
                currentValue=_display_value(current_value),
                incomingValue=_display_value(incoming_value),
            )
        )

    return proposed, proposed_meta, changes


def _display_value(value) -> str:
    """Human-readable string for merge change display."""
    if value is None or value == "":
        return ""
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, list):
        return ", ".join(str(item) for item in value) if value else ""
    return str(value)


def _is_user_edited_meta(meta_value) -> bool:
    """True when field_meta indicates direct user edits."""
    if not meta_value:
        return False
    if hasattr(meta_value, "model_dump"):
        meta_value = meta_value.model_dump()
    if not isinstance(meta_value, dict):
        return False
    return (
        str(meta_value.get("status", "")).lower() == "user-edited"
        or str(meta_value.get("source", "")).lower() == "user"
    )


def _build_listing_draft_response(
    *,
    parsed: ParsedListingData,
    seller: User,
    project: Project | None,
    report: Report | None,
) -> tuple[ListingDraftData, dict[str, ListingFieldMeta]]:
    """Build a ListingDraftData directly from the AI-parsed fields.

    The AI parser already knows the exact form schema and dropdown options,
    so we trust its output directly. We only supplement with factual project
    data (address, sqft) when the AI didn't extract those fields.
    """
    street, parsed_city, parsed_state, parsed_zip = _split_address(
        cast(str | None, project.address) if project else None
    )

    adu_type = (
        _normalize_adu_type(parsed.aduType)
        or _normalize_adu_type(cast(str | None, project.adu_type) if project else None)
        or None
    )
    sqft = parsed.sqft or (
        int(project.adu_sqft)
        if project and project.adu_sqft
        else (int(project.max_adu_sqft) if project and project.max_adu_sqft else None)
    )

    now = datetime.now(timezone.utc).isoformat()

    listing = ListingDraftData(
        id="draft-placeholder",
        projectId=cast(str | None, project.id) if project else None,
        status="draft",
        heroImage="",
        headline=_build_headline(
            parsed.address or street,
            parsed.city or parsed_city,
            adu_type,
        ),
        aduType=adu_type,
        constructionStatus=parsed.constructionStatus,
        address=parsed.address or street,
        city=parsed.city or parsed_city,
        state=parsed_state or "CA",
        zipCode=parsed.zipCode or parsed_zip,
        neighborhood=_normalize(parsed.neighborhood),
        apn="",
        lat=None,
        lng=None,
        bedrooms=parsed.bedrooms,
        bathrooms=parsed.bathrooms,
        sqft=sqft,
        privateEntrance=parsed.privateEntrance,
        unitLevel="",
        kitchenType=parsed.kitchenType,
        inUnitLaundry=parsed.inUnitLaundry,
        permitStatus=parsed.permitStatus,
        certificateOfOccupancy=parsed.certificateOfOccupancy,
        zoningDesignation=_normalize(parsed.zoningDesignation),
        legalRentalStatus=parsed.legalRentalStatus,
        hoaRestrictions=_normalize(parsed.hoaRestrictions),
        shortTermRentalAllowed=parsed.shortTermRentalAllowed,
        monthlyRent=parsed.monthlyRent,
        securityDeposit=parsed.securityDeposit,
        leaseTerm=parsed.leaseTerm,
        utilitiesStrategy=parsed.utilitiesStrategy,
        capRate=parsed.capRate,
        grossYield=parsed.grossYield,
        paybackPeriod=parsed.paybackPeriod,
        constructionCost=parsed.constructionCost,
        floorPlanImage="",
        imageGallery=[],
        videoTourUrl="",
        sellerType=parsed.sellerType,
        contactPreference=parsed.contactPreference,
        responseTime="",
        sellerName=cast(str, seller.name),
        sellerId=_user_id(seller),
        outdoorSpace=parsed.outdoorSpace or "",
        parkingDetails=_normalize(parsed.parkingDetails),
        climateControl=parsed.climateControl,
        neighborhoodInfo=_normalize(parsed.neighborhoodInfo),
        investorMetrics=_normalize(parsed.investorMetrics),
        smartHomeFeatures="",
        furnished=parsed.furnished,
        proximityToEmployers=_normalize(parsed.proximityToEmployers),
        petPolicy=_normalize(parsed.petPolicy),
        images=[],
        amenities=[],
        availableDate="",
        utilitiesIncluded=[],
        parkingIncluded=False,
        petsAllowed=None,
        viewCount=0,
        saveCount=0,
        description=_normalize(parsed.description),
        seoTitle=parsed.address or street or "Draft Listing",
        createdAt=now,
        updatedAt=now,
    )

    # Build field_meta: mark every non-empty field that the AI or project
    # data actually provided as auto-filled.
    field_meta: dict[str, ListingFieldMeta] = {}
    skip_keys = {
        "id",
        "projectId",
        "status",
        "createdAt",
        "updatedAt",
        "sellerId",
        "sellerName",
        "heroImage",
        "floorPlanImage",
        "imageGallery",
        "videoTourUrl",
        "images",
        "viewCount",
        "saveCount",
        "seoTitle",
        "headline",
        "unitLevel",
        "smartHomeFeatures",
        "availableDate",
        "responseTime",
        "parkingIncluded",
        "petsAllowed",
        "amenities",
        "utilitiesIncluded",
    }
    dumped = listing.model_dump()
    for key, value in dumped.items():
        if key in skip_keys:
            continue
        if _is_filled(value):
            field_meta[key] = _auto_meta()

    return listing, field_meta
