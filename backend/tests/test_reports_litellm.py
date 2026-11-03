import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

os.environ.setdefault("SUPABASE_DATABASE_URL", "sqlite:///./test-reports-litellm.db")

from api.llm import litellm_client
from api.routers import reports as reports_router
from api.routers.schemas import (
    HistoryMessage,
    ParsedListingData,
    StructuredReportOutput,
)
from api.database.schemas import ReportContext, ReportVisible
from financial_chatbot.schemas import EstimateRange, FinanceStateSnapshot


def _build_completion_response(content: object, usage: object | None = None):
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=content))],
        usage=usage,
    )


@pytest.mark.anyio
async def test_run_structured_report_completion_uses_json_object_format(monkeypatch):
    captured_kwargs: list[dict[str, object]] = []
    usage = SimpleNamespace(
        prompt_tokens=12,
        completion_tokens=8,
        total_tokens=20,
    )

    async def fake_acompletion(**kwargs):
        captured_kwargs.append(kwargs)
        return _build_completion_response(
            '{"visible":{"executive_summary":"ok"},"context":{"key_questions":[],"implicit_preferences":[],"notable_signals":[]}}',
            usage=usage,
        )

    monkeypatch.setattr(litellm_client.litellm, "acompletion", fake_acompletion)

    result, returned_usage = await reports_router._run_structured_report_completion(
        system_instruction="system",
        user_content="user",
        output_model=StructuredReportOutput,
        api_key="test-key",
        request_id="req-123",
        route="reports",
        workflow_name="Structured Report Writer",
        project_id="project-456",
    )

    assert result.visible.executive_summary == "ok"
    assert returned_usage is usage
    assert captured_kwargs[0]["response_format"] == {"type": "json_object"}


def test_parse_structured_output_accepts_fenced_json():
    result = reports_router._parse_structured_output(
        '```json\n{"address":"123 Oak St","city":"Irvine"}\n```',
        ParsedListingData,
    )

    assert result.address == "123 Oak St"
    assert result.city == "Irvine"


def test_parse_structured_report_output_defaults_missing_context():
    result = reports_router._parse_structured_output(
        '{"visible":{"executive_summary":"ok"}}',
        StructuredReportOutput,
    )

    assert result.visible.executive_summary == "ok"
    assert result.context.key_questions == []
    assert result.context.implicit_preferences == []
    assert result.context.notable_signals == []


@pytest.mark.anyio
async def test_generate_structured_report_is_static_and_skips_report_llm(
    monkeypatch,
):
    now = datetime.now(timezone.utc)

    project = SimpleNamespace(
        id="project-123",
        address="123 Oak St, Irvine, CA 92612",
        county="Orange County",
        adu_sqft=750,
        adu_type="detached",
        finance_state=FinanceStateSnapshot(
            county="Orange County",
            adu_sqft=750,
            base_estimate_value=220000,
            base_estimate_range=EstimateRange(low=176000, high=264000),
            complication_adjusted_value=242000,
            complication_adjusted_range=EstimateRange(low=193600, high=290400),
        ).model_dump(mode="json"),
        report_preload={
            "visible": {
                "requirements": [
                    {
                        "id": "project_intent",
                        "title": "Project intent",
                        "question": "What is the primary intent?",
                        "answer": "Long-term rental income.",
                        "status": "answered",
                    }
                ]
            },
            "context": {
                "key_questions": ["Chat-derived question should be ignored."],
                "implicit_preferences": ["Chat-derived preference should be ignored."],
                "notable_signals": ["Chat-derived signal should be ignored."],
                "requirement_answers": [
                    {
                        "question_id": "project_intent",
                        "section": "requirements",
                        "normalized_value": {"intent": "rental"},
                        "confidence": "high",
                        "missing_fields": [],
                        "source": "selected_option",
                    }
                ],
                "requirement_open_items": ["Budget readiness: confirm funding."],
            },
        },
        report=None,
        draft=None,
    )

    @asynccontextmanager
    async def fake_reserve_llm_budget(**kwargs):
        pytest.fail("static report generation should not reserve report LLM budget")
        yield SimpleNamespace(request_id="req-report-123")

    async def fake_run_completion(**kwargs):
        pytest.fail("static report generation should not call the LLM")

    def fake_create_report(db, project_id, visible, context):
        assert project_id == "project-123"
        return SimpleNamespace(
            id="report-1",
            project_id=project_id,
            version=1,
            visible=visible,
            context=context,
            last_modified=now,
            created_at=now,
        )

    monkeypatch.setattr(
        reports_router,
        "_get_owned_project_or_404",
        lambda db, project_id, user_id: project,
    )
    monkeypatch.setattr(reports_router, "reserve_llm_budget", fake_reserve_llm_budget)
    monkeypatch.setattr(
        reports_router, "_run_structured_report_completion", fake_run_completion
    )
    monkeypatch.setattr(
        reports_router.ReportRepository,
        "get_report_by_project",
        lambda db, project_id, user_id=None: None,
    )
    monkeypatch.setattr(
        reports_router.ReportRepository,
        "create_report",
        fake_create_report,
    )
    response = reports_router.generate_structured_report(
        "project-123",
        reports_router.GenerateStructuredReportRequest(
            messages=[HistoryMessage(role="user", content="Can it work as a rental?")]
        ),
        current_user=SimpleNamespace(id="user-123"),
        db=object(),
    )

    assert response.id == "report-1"
    assert "rental income" not in (response.visible.executive_summary or "")
    assert "**$193,600 to $290,400**" in (response.visible.financial_snapshot or "")
    assert response.visible.requirements == []
    assert response.context.key_questions == []
    assert response.context.implicit_preferences == []
    assert response.context.notable_signals == []
    assert response.context.requirement_answers == []
    assert response.context.requirement_open_items == []


@pytest.mark.anyio
async def test_generate_structured_report_falls_back_to_detailed_recommendations_when_missing(
    monkeypatch,
):
    now = datetime.now(timezone.utc)
    project = SimpleNamespace(
        id="project-123",
        address="123 Oak St, Irvine, CA 92612",
        county="Orange County",
        adu_sqft=750,
        adu_type="detached",
        current_yard_zone="Rear",
        adu_clearances=[],
        primary_use="rental income",
        blocker_types=["utility coordination"],
        fire_hazard_severity="High",
        finance_state={},
        report=None,
        draft=None,
    )

    @asynccontextmanager
    async def fake_reserve_llm_budget(**kwargs):
        yield SimpleNamespace(request_id="req-report-123")

    async def fake_run_completion(**kwargs):
        return (
            StructuredReportOutput(
                visible=ReportVisible(
                    executive_summary="Tailored summary",
                    recommendations=None,
                ),
                context=ReportContext(),
            ),
            None,
        )

    def fake_create_report(db, project_id, visible, context):
        return SimpleNamespace(
            id="report-1",
            project_id=project_id,
            version=1,
            visible=visible,
            context=context,
            last_modified=now,
            created_at=now,
        )

    monkeypatch.setattr(reports_router, "get_openrouter_key", lambda: "test-key")
    monkeypatch.setattr(
        reports_router,
        "_build_report_input",
        lambda project, body: "compiled report input",
    )
    monkeypatch.setattr(
        reports_router,
        "_get_owned_project_or_404",
        lambda db, project_id, user_id: project,
    )
    monkeypatch.setattr(
        reports_router, "ensure_user_api_key", lambda uid: "fake-user-hash"
    )
    monkeypatch.setattr(reports_router, "reserve_llm_budget", fake_reserve_llm_budget)
    monkeypatch.setattr(
        reports_router, "_run_structured_report_completion", fake_run_completion
    )
    monkeypatch.setattr(reports_router, "record_litellm_usage", lambda **kwargs: None)
    monkeypatch.setattr(
        reports_router.ReportRepository,
        "get_report_by_project",
        lambda db, project_id, user_id=None: None,
    )
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

    recommendations = response.visible.recommendations or ""
    assert recommendations.startswith(
        "The following next steps are recommended to advance this project from feasibility into a permit-ready scope"
    )
    assert recommendations.count("\n- ") == 5
    assert "permit-ready package" in recommendations
    assert "preliminary cost estimate as a working budget baseline" in recommendations


@pytest.mark.anyio
async def test_generate_structured_report_uses_deterministic_recommendations(
    monkeypatch,
):
    now = datetime.now(timezone.utc)
    project = SimpleNamespace(
        id="project-123",
        address="123 Oak St, Irvine, CA 92612",
        county="Orange County",
        adu_sqft=750,
        adu_type="detached",
        current_yard_zone=None,
        adu_clearances=[],
        primary_use=None,
        blocker_types=[],
        fire_hazard_severity=None,
        finance_state={},
        report=None,
        draft=None,
    )

    @asynccontextmanager
    async def fake_reserve_llm_budget(**kwargs):
        yield SimpleNamespace(request_id="req-report-123")

    def fake_create_report(db, project_id, visible, context):
        return SimpleNamespace(
            id="report-1",
            project_id=project_id,
            version=1,
            visible=visible,
            context=context,
            last_modified=now,
            created_at=now,
        )

    monkeypatch.setattr(reports_router, "get_openrouter_key", lambda: "test-key")
    monkeypatch.setattr(
        reports_router,
        "_build_report_input",
        lambda project, body: "compiled report input",
    )
    monkeypatch.setattr(
        reports_router,
        "_get_owned_project_or_404",
        lambda db, project_id, user_id: project,
    )
    monkeypatch.setattr(
        reports_router, "ensure_user_api_key", lambda uid: "fake-user-hash"
    )
    monkeypatch.setattr(reports_router, "reserve_llm_budget", fake_reserve_llm_budget)
    monkeypatch.setattr(
        reports_router,
        "_run_structured_report_completion",
        lambda **kwargs: pytest.fail("blank report generation should not call the LLM"),
    )
    monkeypatch.setattr(reports_router, "record_litellm_usage", lambda **kwargs: None)
    monkeypatch.setattr(
        reports_router.ReportRepository,
        "get_report_by_project",
        lambda db, project_id, user_id=None: None,
    )
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

    recommendations = response.visible.recommendations or ""
    assert "<ul>" not in recommendations
    assert "<li>" not in recommendations
    assert recommendations.startswith(
        "The following next steps are recommended to advance this project from feasibility into a permit-ready scope"
    )
    assert recommendations.count("\n- ") == 5


@pytest.mark.anyio
async def test_parse_report_to_listing_reserves_budget_and_records_usage(monkeypatch):
    reserve_calls: list[dict[str, object]] = []
    completion_calls: list[dict[str, object]] = []
    recorded_usage: list[dict[str, object]] = []
    usage = SimpleNamespace(prompt_tokens=9, completion_tokens=4, total_tokens=13)

    @asynccontextmanager
    async def fake_reserve_llm_budget(**kwargs):
        reserve_calls.append(kwargs)
        yield SimpleNamespace(request_id="req-parse-123")

    async def fake_run_completion(**kwargs):
        completion_calls.append(kwargs)
        return (
            ParsedListingData(
                address="123 Oak St",
                city="Irvine",
                aduType="detached",
                sqft=650,
                description="Sunny detached ADU near UCI.",
            ),
            usage,
        )

    monkeypatch.setattr(reports_router, "get_openrouter_key", lambda: "test-key")
    monkeypatch.setattr(
        reports_router, "ensure_user_api_key", lambda uid: "fake-user-hash"
    )
    monkeypatch.setattr(reports_router, "reserve_llm_budget", fake_reserve_llm_budget)
    monkeypatch.setattr(
        reports_router, "_run_structured_report_completion", fake_run_completion
    )
    monkeypatch.setattr(
        reports_router,
        "record_litellm_usage",
        lambda **kwargs: recorded_usage.append(kwargs),
    )

    response = await reports_router.parse_report_to_listing(
        reports_router.ParseReportRequest(report_markdown="# Report"),
        current_user=SimpleNamespace(id="user-123", name="Abhinav"),
        db=object(),
    )

    assert response.action == "create"
    assert response.projectId is None
    assert response.listing.address == "123 Oak St"
    assert response.listing.city == "Irvine"
    assert response.listing.aduType == "detached"
    assert response.listing.sellerId == "user-123"
    assert reserve_calls == [
        {
            "api_key_hash": "fake-user-hash",
            "route": "reports",
            "fallback_cost_micros": 15_000,
            "model": reports_router.REPORT_MODEL,
        }
    ]
    assert completion_calls[0]["request_id"] == "req-parse-123"
    assert completion_calls[0]["workflow_name"] == "Report Parser"
    assert recorded_usage == [
        {
            "model": reports_router.REPORT_MODEL,
            "usage": usage,
            "route": "reports",
            "source": "reports.parse_report_to_listing",
        }
    ]
