import logging
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from api.database.schemas import ReportContext, ReportVisible
from api.report_requirements import build_requirement_questions
from api.report_sanitizer import sanitize_report_visible_fields
from api.routers import reports as reports_router
from api.routers.schemas import RequirementAnswerRequest, RequirementValidationOutput
from orchestrator.hydration import compose_answer_safe_context, compose_internal_context


def make_project(**overrides):
    defaults = {
        "id": "project-123",
        "user_id": "user-123",
        "address": "123 Oak St",
        "primary_use": None,
        "adu_type": None,
        "finance_state": None,
        "report_preload": None,
        "blocker_types": [],
        "fire_hazard_severity": None,
        "report": None,
        "draft": None,
    }
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def make_report(
    *,
    visible: dict | None = None,
    context: dict | None = None,
    version: int = 1,
):
    return SimpleNamespace(
        id="report-123",
        project_id="project-123",
        version=version,
        visible=ReportVisible(**(visible or {})).model_dump(mode="json"),
        context=ReportContext(**(context or {})).model_dump(mode="json"),
        last_modified=datetime.now(timezone.utc),
        created_at=datetime.now(timezone.utc),
    )


def test_requirement_questions_are_deterministic_and_project_aware():
    project = make_project(finance_state={"base_estimate_range": {"low": 1, "high": 2}})

    questions = build_requirement_questions(project)

    assert len(questions) == 6
    assert questions[0].id == "project_intent"
    assert questions[0].step == 1
    assert questions[0].total_steps == 6
    recommended = [option.id for option in questions[0].options if option.recommended]
    assert recommended == ["long_term_rental_income"]
    assert questions[0].answered is False
    assert questions[0].status == "unanswered"


def test_requirement_routes_are_not_registered():
    registered_paths = {route.path for route in reports_router.router.routes}

    assert (
        "/projects/{project_id}/report/requirements/questions" not in registered_paths
    )
    assert "/projects/{project_id}/report/requirements/answers" not in registered_paths


def test_active_report_inputs_ignore_requirement_fields():
    visible = reports_router.sanitize_active_report_visible(
        {"executive_summary": "Summary", "requirements": [{"id": "intent"}]}
    )
    context = reports_router.sanitize_active_report_context(
        {
            "key_questions": ["Question"],
            "requirement_answers": [{"question_id": "intent"}],
            "requirement_open_items": ["Budget"],
        }
    )

    assert visible == {"executive_summary": "Summary"}
    assert context == {"key_questions": ["Question"]}


def test_requirement_questions_ignore_legacy_preloaded_answer_state():
    project = make_project(
        report_preload={
            "visible": {
                "requirements": [
                    {
                        "id": "project_intent",
                        "title": "Project Intent",
                        "question": "What is the main reason?",
                        "answer": "Long-term rental income: Prioritize rentability.",
                        "selected_option_id": "long_term_rental_income",
                        "status": "answered",
                    }
                ]
            }
        }
    )

    questions = build_requirement_questions(project)

    assert questions[0].answered is False
    assert questions[0].status == "unanswered"
    assert questions[0].selected_option_id is None
    assert questions[0].answer is None
    assert questions[1].answered is False


def test_requirement_questions_include_report_answer_state():
    project = make_project(
        report=make_report(
            visible={
                "requirements": [
                    {
                        "id": "budget_readiness",
                        "title": "Budget Readiness",
                        "question": "How ready is the budget?",
                        "answer": "Under $250k if possible.",
                        "status": "needs_review",
                    }
                ]
            }
        )
    )

    questions = build_requirement_questions(project)
    budget_question = next(
        question for question in questions if question.id == "budget_readiness"
    )

    assert budget_question.answered is True
    assert budget_question.status == "needs_review"
    assert budget_question.answer == "Under $250k if possible."


@pytest.mark.anyio
async def test_selected_requirement_answer_requires_generated_report(monkeypatch):
    project = make_project(finance_state={"base_estimate_range": {"low": 1, "high": 2}})

    monkeypatch.setattr(
        reports_router,
        "_get_owned_project_or_404",
        lambda db, project_id, user_id: project,
    )
    monkeypatch.setattr(
        reports_router.ReportRepository,
        "get_report_by_project",
        lambda db, project_id, user_id=None: None,
    )
    monkeypatch.setattr(
        reports_router.ReportRepository,
        "get_project",
        lambda db, project_id, user_id=None: project,
    )

    monkeypatch.setattr(
        reports_router.ReportRepository,
        "create_report",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError(
                "answering a requirement should preload, not create a report"
            )
        ),
    )

    async def fail_completion(**kwargs):
        raise AssertionError("LLM validation should not run for option-only answers")

    monkeypatch.setattr(
        reports_router,
        "_run_structured_report_completion",
        fail_completion,
    )

    with pytest.raises(HTTPException) as exc_info:
        await reports_router.answer_report_requirement(
            "project-123",
            RequirementAnswerRequest(
                question_id="project_intent",
                selected_option_id="long_term_rental_income",
            ),
            current_user=SimpleNamespace(id="user-123"),
            db=object(),
        )

    assert exc_info.value.status_code == 409


@pytest.mark.anyio
async def test_custom_requirement_answer_persists_validation(monkeypatch):
    project = make_project()
    existing = make_report(
        visible={
            "requirements": [
                {
                    "id": "project_intent",
                    "title": "Project Intent",
                    "question": "old",
                    "answer": "old",
                    "status": "answered",
                }
            ]
        },
        context={"requirement_answers": []},
        version=2,
    )
    updated_reports: list[SimpleNamespace] = []

    monkeypatch.setattr(
        reports_router,
        "_get_owned_project_or_404",
        lambda db, project_id, user_id: project,
    )
    monkeypatch.setattr(
        reports_router.ReportRepository,
        "get_report_by_project",
        lambda db, project_id, user_id=None: existing,
    )

    def fake_delta_update(db, project_id, update, expected_version=None, user_id=None):
        visible = {**existing.visible, **(update.visible or {})}
        context = {**existing.context, **(update.context or {})}
        report = make_report(visible=visible, context=context, version=3)
        updated_reports.append(report)
        return report

    monkeypatch.setattr(
        reports_router.ReportRepository,
        "delta_update",
        fake_delta_update,
    )

    async def fake_validate_requirement_answer(**kwargs):
        return RequirementValidationOutput(
            accepted=True,
            normalized_value={"budget_status": "target_budget_exists"},
            display_answer="The owner wants to keep the ADU under $250,000.",
        )

    monkeypatch.setattr(
        reports_router,
        "validate_requirement_answer",
        fake_validate_requirement_answer,
    )

    response = await reports_router.answer_report_requirement(
        "project-123",
        RequirementAnswerRequest(
            question_id="budget_readiness",
            custom_answer="Under $250k if possible",
            expected_version=2,
        ),
        current_user=SimpleNamespace(id="user-123"),
        db=object(),
    )

    assert response.report.version == 3
    assert response.report.visible.requirements == []
    assert response.report.context.requirement_answers == []
    assert len(updated_reports[0].visible["requirements"]) == 2
    assert updated_reports[0].context["requirement_answers"][0]["normalized_value"] == {
        "budget_status": "target_budget_exists"
    }


@pytest.mark.anyio
async def test_requirement_answers_do_not_accumulate_before_report(monkeypatch):
    project = make_project(
        report_preload={
            "visible": {
                "requirements": [
                    {
                        "id": "project_intent",
                        "title": "Project Intent",
                        "question": "What is the main reason?",
                        "answer": "Long-term rental income",
                        "selected_option_id": "long_term_rental_income",
                        "status": "answered",
                    }
                ]
            },
            "context": {
                "requirement_answers": [
                    {
                        "question_id": "project_intent",
                        "section": "Project Intent",
                        "normalized_value": {
                            "rental_intent": "long_term_rental",
                        },
                        "confidence": "high",
                        "missing_fields": [],
                        "source": "selected_option",
                    }
                ],
                "requirement_open_items": [],
            },
        }
    )

    monkeypatch.setattr(
        reports_router,
        "_get_owned_project_or_404",
        lambda db, project_id, user_id: project,
    )
    monkeypatch.setattr(
        reports_router.ReportRepository,
        "get_report_by_project",
        lambda db, project_id, user_id=None: None,
    )
    monkeypatch.setattr(
        reports_router.ReportRepository,
        "get_project",
        lambda db, project_id, user_id=None: project,
    )

    with pytest.raises(HTTPException) as exc_info:
        await reports_router.answer_report_requirement(
            "project-123",
            RequirementAnswerRequest(
                question_id="budget_readiness",
                selected_option_id="lowest_practical_cost",
            ),
            current_user=SimpleNamespace(id="user-123"),
            db=object(),
        )

    assert exc_info.value.status_code == 409


@pytest.mark.anyio
async def test_generate_report_ignores_legacy_preloaded_requirement_answers(
    monkeypatch,
):
    project = make_project(
        report_preload={
            "visible": {
                "requirements": [
                    {
                        "id": "project_intent",
                        "title": "Project Intent",
                        "question": "What is the main reason?",
                        "answer": "Long-term rental income",
                        "selected_option_id": "long_term_rental_income",
                        "status": "answered",
                    }
                ]
            },
            "context": {
                "requirement_answers": [
                    {
                        "question_id": "project_intent",
                        "section": "Project Intent",
                        "normalized_value": {
                            "rental_intent": "long_term_rental",
                        },
                        "confidence": "high",
                        "missing_fields": [],
                        "source": "selected_option",
                    }
                ]
            },
        }
    )

    monkeypatch.setattr(
        reports_router,
        "_get_owned_project_or_404",
        lambda db, project_id, user_id: project,
    )
    monkeypatch.setattr(
        reports_router.ReportRepository,
        "get_report_by_project",
        lambda db, project_id, user_id=None: None,
    )

    def fake_create_report(db, project_id, visible, context):
        return make_report(visible=visible, context=context, version=1)

    monkeypatch.setattr(
        reports_router.ReportRepository,
        "create_report",
        fake_create_report,
    )
    response = reports_router.generate_structured_report(
        "project-123",
        reports_router.GenerateStructuredReportRequest(),
        current_user=SimpleNamespace(id="user-123"),
        db=object(),
    )

    assert response.visible.requirements == []
    assert response.context.requirement_answers == []


def test_sanitize_report_visible_fields_sanitizes_nested_requirements():
    visible = {
        "requirements": [
            {
                "id": "project_intent",
                "title": "Project Intent [1]",
                "question": "Why build? [2]",
                "answer": "Rental income [3]",
            }
        ]
    }

    sanitized = sanitize_report_visible_fields(visible)

    assert sanitized["requirements"][0]["title"] == "Project Intent"
    assert sanitized["requirements"][0]["question"] == "Why build?"
    assert sanitized["requirements"][0]["answer"] == "Rental income"


def test_hydration_excludes_requirement_context_by_default():
    visible_context = compose_answer_safe_context(
        {
            "requirements": [
                {
                    "title": "Project Intent",
                    "answer": "Long-term rental income",
                }
            ]
        }
    )
    internal_context = compose_internal_context(
        {
            "requirement_answers": [
                {
                    "question_id": "project_intent",
                    "section": "Project Intent",
                    "normalized_value": {"rental_intent": "long_term_rental"},
                    "confidence": "high",
                    "missing_fields": [],
                    "source": "selected_option",
                }
            ],
            "requirement_open_items": ["Budget Readiness: budget_status"],
        }
    )

    assert "Requirements & Owner Inputs" not in visible_context
    assert "Requirement Answers" not in internal_context
    assert "Requirement Open Items" not in internal_context


def test_hydration_can_format_dormant_requirement_context():
    visible_context = compose_answer_safe_context(
        {"requirements": [{"title": "Project Intent", "answer": "Rental"}]},
        include_guided_requirements=True,
    )
    internal_context = compose_internal_context(
        {
            "requirement_answers": [{"question_id": "project_intent"}],
            "requirement_open_items": ["Confirm budget"],
        },
        include_guided_requirements=True,
    )

    assert "### Requirements & Owner Inputs" in visible_context
    assert "### Requirement Answers" in internal_context
    assert "### Requirement Open Items" in internal_context


def test_log_guided_requirements_turn_usage_no_llm(caplog):
    from api.rate_limiting.llm_usage import log_guided_requirements_turn_usage

    with caplog.at_level(logging.INFO):
        log_guided_requirements_turn_usage(
            project_id="project-123",
            question_id="project_intent",
            answer_source="selected_option",
            status="answered",
            llm_used=False,
            reason="selected_option_only",
        )

    record = next(
        item
        for item in caplog.records
        if item.message == "Guided requirement turn completed without LLM"
    )
    assert record.tag == "[guided-requirements-turn]"
    assert record.project_id == "project-123"
    assert record.question_id == "project_intent"
    assert record.usage_status == "no_llm"
    assert record.reason == "selected_option_only"


def test_log_guided_requirements_turn_usage_with_breakdown(caplog):
    from api.rate_limiting.llm_usage import (
        LLMUsageBreakdown,
        log_guided_requirements_turn_usage,
        record_usage_breakdown,
        usage_accumulator_scope,
    )

    with usage_accumulator_scope() as accumulator:
        baseline = accumulator.breakdown_count()
        record_usage_breakdown(
            LLMUsageBreakdown(
                model="deepseek-v4-flash",
                prompt_tokens=120,
                completion_tokens=45,
                total_tokens=165,
                cached_tokens=0,
                cost_micros=300,
                is_estimated=False,
                route="reports",
                source="reports.validate_requirement_answer",
            )
        )
        with caplog.at_level(logging.INFO):
            log_guided_requirements_turn_usage(
                project_id="project-123",
                question_id="budget_readiness",
                answer_source="free_text",
                status="answered",
                llm_used=True,
                since=baseline,
            )

    record = next(
        item
        for item in caplog.records
        if item.message == "Guided requirement turn usage recorded"
    )
    assert record.tag == "[guided-requirements-turn]"
    assert record.question_id == "budget_readiness"
    assert record.answer_source == "free_text"
    assert record.input_tokens == 120
    assert record.output_tokens == 45
    assert record.breakdowns[0]["source"] == "reports.validate_requirement_answer"


@pytest.mark.anyio
async def test_selected_requirement_answer_logs_no_llm(caplog, monkeypatch):
    project = make_project(finance_state={"base_estimate_range": {"low": 1, "high": 2}})

    monkeypatch.setattr(
        reports_router,
        "_get_owned_project_or_404",
        lambda db, project_id, user_id: project,
    )
    monkeypatch.setattr(
        reports_router.ReportRepository,
        "get_report_by_project",
        lambda db, project_id, user_id=None: None,
    )
    monkeypatch.setattr(
        reports_router.ReportRepository,
        "get_project",
        lambda db, project_id, user_id=None: project,
    )
    with caplog.at_level(logging.INFO):
        with pytest.raises(HTTPException):
            await reports_router.answer_report_requirement(
                "project-123",
                RequirementAnswerRequest(
                    question_id="project_intent",
                    selected_option_id="long_term_rental_income",
                ),
                current_user=SimpleNamespace(id="user-123"),
                db=object(),
            )

    assert any(
        record.message == "Guided requirements turn started"
        and record.question_id == "project_intent"
        for record in caplog.records
    )
    assert any(
        record.message == "Guided requirement turn completed without LLM"
        and record.usage_status == "no_llm"
        for record in caplog.records
    )
