from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest

import financial_chatbot.router as financial_router
import orchestrator.graph as orchestrator_graph
import orchestrator.router as orchestrator_router
from api.database import core as db_core
from api.database.repository import ReportRepository
from financial_chatbot.calculator import build_finance_presentation
from financial_chatbot.graph import FinanceConsultantGraphResult
from financial_chatbot.schemas import (
    CalculatorRequest,
    ChatMessage,
    ChatRequest,
    FinancialChatStreamEvent,
    FinanceStateSnapshot,
    FinancialChatResult,
)
from financial_chatbot.service import build_finance_state, calculate_finance_snapshot
from orchestrator.schemas import OrchestratorRequest

TEST_USER = SimpleNamespace(id="user-123")


def build_stored_state() -> dict:
    return {
        "county": "Contra Costa County",
        "adu_sqft": 600,
        "complication_flags": {
            "electric_panel": True,
        },
    }


def test_calculate_finance_snapshot_preserves_manual_complications():
    finance_state, presentation = calculate_finance_snapshot(
        stored_finance_state=build_stored_state(),
        county="Contra Costa County",
        adu_sqft=600,
        adu_type="detached",
        address="2263 Rosemount Ln",
        fire_hazard_severity="Moderate",
        fire_hazard_zone_type="LRA",
    )

    assert finance_state.complication_flags.electric_panel is True
    assert finance_state.complication_flags.solar_mandate is True
    assert finance_state.complication_flags.fire_resilient_upgrades is True
    assert presentation.base_estimate_range is not None
    assert any(
        addon.key == "electric_panel" and addon.is_selected
        for addon in presentation.manual_addons
    )
    assert any(addon.key == "solar_mandate" for addon in presentation.automatic_addons)
    assert any(
        addon.key == "fire_resilient_upgrades"
        for addon in presentation.automatic_addons
    )


def test_finance_state_auto_adds_fire_solar_and_contingency_costs():
    finance_state = build_finance_state(
        stored_finance_state=None,
        address="2263 Rosemount Ln",
        county="Contra Costa County",
        adu_sqft=600,
        adu_type="detached",
        fire_hazard_severity="Very High",
        fire_hazard_zone_type="SRA",
    )

    assert finance_state.complication_flags.solar_mandate is True
    assert finance_state.complication_flags.fire_resilient_upgrades is False
    assert finance_state.complication_flags.very_high_fire_risk is True
    assert finance_state.complication_flags.contingency is True
    assert finance_state.complication_adjusted_value == 322795.0
    assert finance_state.complication_adjusted_range is not None
    assert finance_state.complication_adjusted_range.low == 258236.0
    assert finance_state.complication_adjusted_range.high == 387354.0


def test_finance_state_auto_adds_fire_resilient_upgrades_for_moderate_zones():
    finance_state = build_finance_state(
        stored_finance_state=None,
        address="2263 Rosemount Ln",
        county="Contra Costa County",
        adu_sqft=600,
        adu_type="detached",
        fire_hazard_severity="Moderate",
        fire_hazard_zone_type="LRA",
    )

    assert finance_state.complication_flags.solar_mandate is True
    assert finance_state.complication_flags.fire_resilient_upgrades is True
    assert finance_state.complication_flags.very_high_fire_risk is False
    assert finance_state.complication_flags.contingency is True
    assert finance_state.complication_adjusted_value == 315920.0
    assert finance_state.complication_adjusted_range is not None
    assert finance_state.complication_adjusted_range.low == 252736.0
    assert finance_state.complication_adjusted_range.high == 379104.0


def test_finance_state_auto_adds_fire_resilient_upgrades_for_high_zones():
    finance_state = build_finance_state(
        stored_finance_state=None,
        address="2263 Rosemount Ln",
        county="Contra Costa County",
        adu_sqft=600,
        adu_type="detached",
        fire_hazard_severity="High",
        fire_hazard_zone_type="SRA",
    )

    assert finance_state.complication_flags.fire_resilient_upgrades is True
    assert finance_state.complication_flags.very_high_fire_risk is False


def test_finance_state_auto_adds_tentative_fire_upgrades_for_unknown_zones():
    finance_state = build_finance_state(
        stored_finance_state=None,
        address="2263 Rosemount Ln",
        county="Contra Costa County",
        adu_sqft=600,
        adu_type="detached",
        fire_hazard_severity="Unknown",
        fire_hazard_zone_type="Manual",
    )

    presentation = build_finance_presentation(finance_state)
    fire_addon = next(
        addon
        for addon in presentation.automatic_addons
        if addon.key == "fire_resilient_upgrades"
    )

    assert finance_state.complication_flags.fire_resilient_upgrades is True
    assert finance_state.complication_flags.very_high_fire_risk is False
    assert fire_addon.trigger_reason is not None
    assert "tentative" in fire_addon.trigger_reason
    assert "requirements" in fire_addon.trigger_reason


def test_finance_state_skips_fire_addons_for_no_designated_zone():
    finance_state = build_finance_state(
        stored_finance_state=None,
        address="2263 Rosemount Ln",
        county="Contra Costa County",
        adu_sqft=600,
        adu_type="detached",
        fire_hazard_severity="None",
        fire_hazard_zone_type="Manual",
    )

    assert finance_state.complication_flags.fire_resilient_upgrades is False
    assert finance_state.complication_flags.very_high_fire_risk is False


def test_detached_base_estimate_uses_marginal_tiers_at_800_sqft():
    finance_state = build_finance_state(
        stored_finance_state=None,
        address="2263 Rosemount Ln",
        county="Contra Costa County",
        adu_sqft=800,
        adu_type="detached",
        fire_hazard_severity="Moderate",
        fire_hazard_zone_type="LRA",
    )

    # (400*350 + 350*265 + 50*200) * 1.4
    assert finance_state.base_estimate_value == 339850.0


def test_detached_base_estimate_uses_overflow_rate_above_750_sqft():
    finance_state = build_finance_state(
        stored_finance_state=None,
        address="2263 Rosemount Ln",
        county="Contra Costa County",
        adu_sqft=1000,
        adu_type="detached",
        fire_hazard_severity="Moderate",
        fire_hazard_zone_type="LRA",
    )

    # (400*350 + 350*265 + 250*200) * 1.4
    assert finance_state.base_estimate_value == 395850.0


def test_attached_base_estimate_uses_marginal_tiers_at_800_sqft():
    finance_state = build_finance_state(
        stored_finance_state=None,
        address="2263 Rosemount Ln",
        county="Contra Costa County",
        adu_sqft=800,
        adu_type="attached",
        fire_hazard_severity="Moderate",
        fire_hazard_zone_type="LRA",
    )

    # (400*300 + 350*225 + 50*165) * 1.4
    assert finance_state.base_estimate_value == 289800.0


def test_attached_base_estimate_uses_overflow_rate_above_750_sqft():
    finance_state = build_finance_state(
        stored_finance_state=None,
        address="2263 Rosemount Ln",
        county="Contra Costa County",
        adu_sqft=1000,
        adu_type="attached",
        fire_hazard_severity="Moderate",
        fire_hazard_zone_type="LRA",
    )

    # (400*300 + 350*225 + 250*165) * 1.4
    assert finance_state.base_estimate_value == 336000.0


def test_detached_base_estimate_floors_small_units():
    finance_state = build_finance_state(
        stored_finance_state=None,
        address="2263 Rosemount Ln",
        county=None,
        adu_sqft=200,
        adu_type="detached",
        fire_hazard_severity="Unknown",
        fire_hazard_zone_type="Manual",
    )

    # marginal cost 200*350 = 70,000 -> floored to 140,000
    assert finance_state.base_estimate_value == 140000.0


def test_detached_base_estimate_meets_floor_exactly_at_400_sqft():
    finance_state = build_finance_state(
        stored_finance_state=None,
        address="2263 Rosemount Ln",
        county=None,
        adu_sqft=400,
        adu_type="detached",
        fire_hazard_severity="Unknown",
        fire_hazard_zone_type="Manual",
    )

    # 400*350 = 140,000, exactly the floor
    assert finance_state.base_estimate_value == 140000.0


def test_detached_base_estimate_clears_floor_above_400_sqft():
    finance_state = build_finance_state(
        stored_finance_state=None,
        address="2263 Rosemount Ln",
        county=None,
        adu_sqft=600,
        adu_type="detached",
        fire_hazard_severity="Unknown",
        fire_hazard_zone_type="Manual",
    )

    # 400*350 + 200*265 = 193,000
    assert finance_state.base_estimate_value == 193000.0


def test_attached_base_estimate_floors_small_units():
    finance_state = build_finance_state(
        stored_finance_state=None,
        address="2263 Rosemount Ln",
        county=None,
        adu_sqft=200,
        adu_type="attached",
        fire_hazard_severity="Unknown",
        fire_hazard_zone_type="Manual",
    )

    # marginal cost 200*300 = 60,000 -> floored to 122,500
    assert finance_state.base_estimate_value == 122500.0


def test_attached_base_estimate_clears_floor_above_409_sqft():
    finance_state = build_finance_state(
        stored_finance_state=None,
        address="2263 Rosemount Ln",
        county=None,
        adu_sqft=600,
        adu_type="attached",
        fire_hazard_severity="Unknown",
        fire_hazard_zone_type="Manual",
    )

    # 400*300 + 200*225 = 165,000
    assert finance_state.base_estimate_value == 165000.0


def test_unknown_adu_type_uses_detached_pricing():
    finance_state = build_finance_state(
        stored_finance_state=None,
        address="2263 Rosemount Ln",
        county=None,
        adu_sqft=200,
        adu_type=None,
        fire_hazard_severity="Unknown",
        fire_hazard_zone_type="Manual",
    )

    # detached model applies: floored to 140,000
    assert finance_state.base_estimate_value == 140000.0


def test_finance_state_recomputes_legacy_detached_estimate_without_pricing_metadata():
    finance_state = build_finance_state(
        stored_finance_state={
            "county": "Contra Costa County",
            "adu_sqft": 1000,
            "adu_type": "detached",
            "base_estimate_value": 377000.0,
            "base_estimate_range": {
                "low": 301600.0,
                "high": 452400.0,
            },
        },
        address="2263 Rosemount Ln",
        county="Contra Costa County",
        adu_sqft=1000,
        adu_type="detached",
        fire_hazard_severity="Moderate",
        fire_hazard_zone_type="LRA",
    )

    assert finance_state.base_estimate_value == 395850.0
    assert finance_state.base_estimate_inputs is not None
    assert finance_state.base_estimate_inputs.pricing_version == 5


def test_finance_state_recomputes_legacy_attached_estimate_with_new_pricing():
    finance_state = build_finance_state(
        stored_finance_state={
            "county": "Contra Costa County",
            "adu_sqft": 1000,
            "adu_type": "attached",
            "base_estimate_value": 377000.0,
            "base_estimate_range": {
                "low": 301600.0,
                "high": 452400.0,
            },
            "base_estimate_inputs": {
                "county": "Contra Costa County",
                "adu_sqft": 1000,
                "adu_type": "attached",
                "pricing_version": 3,
            },
        },
        address="2263 Rosemount Ln",
        county="Contra Costa County",
        adu_sqft=1000,
        adu_type="attached",
        fire_hazard_severity="Moderate",
        fire_hazard_zone_type="LRA",
    )

    assert finance_state.base_estimate_value == 336000.0
    assert finance_state.base_estimate_inputs is not None
    assert finance_state.base_estimate_inputs.pricing_version == 5


def test_finance_state_recomputes_base_estimate_when_pricing_inputs_change():
    finance_state = build_finance_state(
        stored_finance_state={
            "county": "Contra Costa County",
            "adu_sqft": 1000,
            "adu_type": "detached",
            "base_estimate_value": 353800.0,
            "base_estimate_range": {
                "low": 283040.0,
                "high": 424560.0,
            },
            "base_estimate_inputs": {
                "county": "Contra Costa County",
                "adu_sqft": 1000,
                "adu_type": "detached",
                "pricing_version": 4,
            },
        },
        address="2263 Rosemount Ln",
        county="San Bernardino County",
        adu_sqft=1000,
        adu_type="attached",
        fire_hazard_severity="Moderate",
        fire_hazard_zone_type="LRA",
    )

    assert finance_state.base_estimate_value == 264000.0
    assert finance_state.base_estimate_inputs is not None
    assert finance_state.base_estimate_inputs.county == "San Bernardino County"
    assert finance_state.base_estimate_inputs.adu_type == "attached"


def test_finance_presentation_tracks_manual_and_automatic_addons():
    finance_state = build_finance_state(
        stored_finance_state={"complication_flags": {"electric_panel": True}},
        address="2263 Rosemount Ln",
        county="Contra Costa County",
        adu_sqft=600,
        adu_type="detached",
        fire_hazard_severity="Moderate",
        fire_hazard_zone_type="LRA",
    )

    presentation = build_finance_presentation(finance_state)

    assert (
        presentation.current_estimate_range == finance_state.complication_adjusted_range
    )
    assert any(addon.key == "solar_mandate" for addon in presentation.automatic_addons)
    assert any(
        addon.key == "fire_resilient_upgrades"
        for addon in presentation.automatic_addons
    )
    assert any(
        addon.key == "electric_panel" and addon.is_selected
        for addon in presentation.manual_addons
    )


@pytest.mark.anyio
async def test_calculator_endpoint_round_trips_finance_state():
    request_state = build_stored_state()

    response = financial_router.calculator_endpoint(
        CalculatorRequest(
            finance_state=request_state,
            county="Contra Costa County",
            adu_sqft=600,
            adu_type="detached",
            address="2263 Rosemount Ln",
        ),
        current_user=TEST_USER,
    )

    assert response.finance_state["complication_flags"]["electric_panel"] is True
    assert any(
        addon.key == "electric_panel" and addon.is_selected
        for addon in response.presentation.manual_addons
    )


@pytest.mark.anyio
async def test_chat_endpoint_round_trips_finance_state(monkeypatch):
    @asynccontextmanager
    async def noop_reserve(**kwargs):
        yield

    monkeypatch.setattr(financial_router, "reserve_llm_budget", noop_reserve)
    monkeypatch.setattr(
        financial_router,
        "ensure_user_api_key",
        lambda uid: "fake-user-hash",
    )

    captured_request_state: dict | None = None
    response_state = build_finance_state(
        stored_finance_state=build_stored_state(),
        county="Contra Costa County",
        adu_sqft=600,
        adu_type="detached",
        address="2263 Rosemount Ln",
        fire_hazard_severity="Moderate",
        fire_hazard_zone_type="LRA",
    )

    async def fake_run_financial_chat(*, stored_finance_state=None, **kwargs):
        nonlocal captured_request_state
        captured_request_state = stored_finance_state
        return FinancialChatResult(
            answer="Reply",
            sources=[],
            suggested_questions=[],
            finance_state=response_state,
            presentation=build_finance_presentation(response_state),
            route="consultant",
        )

    monkeypatch.setattr(financial_router, "run_financial_chat", fake_run_financial_chat)

    request_state = build_stored_state()
    response = await financial_router.chat_endpoint(
        ChatRequest(
            messages=[ChatMessage(role="user", content="Explain septic tank work.")],
            finance_state=request_state,
        ),
        current_user=TEST_USER,
    )

    assert captured_request_state == request_state
    assert response.finance_state == response_state.model_dump(mode="json")
    assert response.model_dump() == {
        "reply": "Reply",
        "finance_state": response_state.model_dump(mode="json"),
    }


def test_finance_router_removes_legacy_report_endpoint():
    route_paths = {route.path for route in financial_router.router.routes}
    assert "/chatbot/financial-report" not in route_paths


@pytest.mark.anyio
async def test_orchestrate_stream_resume_emits_dynamic_suggested_questions(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(
        orchestrator_router,
        "ensure_user_api_key",
        lambda uid: "fake-user-hash",
    )

    @asynccontextmanager
    async def fake_reserve_llm_budget(**kwargs):
        yield SimpleNamespace(request_id="test-request")

    monkeypatch.setattr(
        orchestrator_router,
        "reserve_llm_budget",
        fake_reserve_llm_budget,
    )

    async def fake_hydrate_project_node(state):
        return state

    async def fake_generate_welcome_summary_node(state):
        return {**state, "welcome_summary": "Resume summary"}

    async def fake_generate_suggested_questions(question: str, answer: str):
        assert question == orchestrator_router.RESUME_SUGGESTION_SEED
        assert answer == "Resume summary"
        return ["Setback rules", "Permit timing"]

    monkeypatch.setattr(
        orchestrator_router, "hydrate_project_node", fake_hydrate_project_node
    )
    monkeypatch.setattr(
        orchestrator_router,
        "generate_welcome_summary_node",
        fake_generate_welcome_summary_node,
    )
    monkeypatch.setattr(
        orchestrator_router,
        "generate_suggested_questions",
        fake_generate_suggested_questions,
    )

    response = await orchestrator_router.orchestrate_stream(
        OrchestratorRequest(message="SYSTEM_RESUME_CHAT"),
        current_user=TEST_USER,
    )

    chunks: list[str] = []
    async for chunk in response.body_iterator:
        chunks.append(chunk if isinstance(chunk, str) else chunk.decode())

    body = "".join(chunks)
    assert 'data: {"text": "Resume summary"}' in body
    assert (
        'event: suggested_questions\ndata: ["Setback rules", "Permit timing"]' in body
    )
    assert body.index("event: suggested_questions") < body.index("event: done")


@pytest.mark.anyio
async def test_orchestrate_stream_finance_emits_stage_updates_and_true_text_stream(
    monkeypatch,
):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(
        orchestrator_router,
        "ensure_user_api_key",
        lambda uid: "fake-user-hash",
    )

    @asynccontextmanager
    async def fake_reserve_llm_budget(**kwargs):
        yield SimpleNamespace(request_id="test-request")

    monkeypatch.setattr(
        orchestrator_router,
        "reserve_llm_budget",
        fake_reserve_llm_budget,
    )

    updated_state = FinanceStateSnapshot(adu_sqft=600)

    async def fake_guardrail_node(state):
        return state

    async def fake_hydrate_project_node(state):
        return state

    async def fake_orchestrate_node(state):
        return {**state, "route": "ROUTE_FINANCE"}

    async def fake_stream_financial_chat(**kwargs):
        yield FinancialChatStreamEvent(
            "finance_state",
            updated_state.model_dump(mode="json"),
        )
        yield FinancialChatStreamEvent("status", "Planning research...")
        yield FinancialChatStreamEvent("status", "Searching the web...")
        yield FinancialChatStreamEvent("text", "Steel framing can ")
        yield FinancialChatStreamEvent("text", "cost more upfront [1].")
        yield FinancialChatStreamEvent(
            "sources",
            [{"source": "Cost study", "url": "https://example.com/cost-study"}],
        )
        yield FinancialChatStreamEvent("status", "Generating follow-up ideas...")
        yield FinancialChatStreamEvent(
            "suggested_questions",
            ["What about prefab timelines?"],
        )
        yield FinancialChatStreamEvent(
            "result",
            FinancialChatResult(
                answer="Steel framing can cost more upfront [1].",
                sources=[
                    {
                        "source": "Cost study",
                        "url": "https://example.com/cost-study",
                    }
                ],
                suggested_questions=["What about prefab timelines?"],
                finance_state=updated_state,
                presentation=build_finance_presentation(updated_state),
                route="consultant",
            ),
        )

    # Rephrase runs alongside routing; stub it so the test stays offline.
    monkeypatch.setattr(orchestrator_router, "rephraser_node", lambda state: state)
    monkeypatch.setattr(
        orchestrator_router,
        "guardrail_node",
        fake_guardrail_node,
    )
    monkeypatch.setattr(
        orchestrator_router,
        "hydrate_project_node",
        fake_hydrate_project_node,
    )
    monkeypatch.setattr(
        orchestrator_router,
        "orchestrate_node",
        fake_orchestrate_node,
    )
    monkeypatch.setattr(
        orchestrator_router,
        "stream_financial_chat",
        fake_stream_financial_chat,
    )

    response = await orchestrator_router.orchestrate_stream(
        OrchestratorRequest(message="Compare steel framing."),
        current_user=TEST_USER,
    )

    chunks: list[str] = []
    async for chunk in response.body_iterator:
        chunks.append(chunk if isinstance(chunk, str) else chunk.decode())

    body = "".join(chunks)
    assert (
        'event: finance_state\ndata: {"address": null, "county": null, "adu_sqft": 600.0'
        in body
    )
    assert 'event: status\ndata: {"stage": "Planning research..."}' in body
    assert 'event: status\ndata: {"stage": "Searching the web..."}' in body
    assert 'data: {"text": "Steel framing can "}' in body
    assert 'data: {"text": "cost more upfront [1]."}' in body
    assert 'event: suggested_questions\ndata: ["What about prefab timelines?"]' in body
    assert body.index("event: finance_state") < body.index(
        'data: {"text": "Steel framing can "}'
    )
    assert body.index('data: {"text": "cost more upfront [1]."}') < body.index(
        "event: suggested_questions"
    )


@pytest.mark.anyio
async def test_financial_chat_uses_consultant_with_calculator_context(monkeypatch):
    async def fake_run_finance_consultant_graph(*args, **kwargs):
        finance_state = kwargs["finance_state"]
        assert finance_state.complication_flags.electric_panel is True
        presentation = kwargs["presentation"]
        assert any(
            addon.key == "electric_panel" and addon.is_selected
            for addon in presentation.manual_addons
        )
        return FinanceConsultantGraphResult(
            answer="Electrical panel upgrade is supported by the calculator and currently included in your estimate [1].",
            research_summary="Panel upgrades are often triggered by insufficient service capacity.",
            sources=[
                {
                    "page_number": None,
                    "source": "Electrical guide",
                    "regulation_topic": "electrical",
                    "chunk_text": "Panel upgrades may be required when existing electrical service is undersized.",
                    "url": "https://example.com/electrical",
                }
            ],
            suggested_questions=["How do I confirm this applies?"],
        )

    monkeypatch.setattr(
        "financial_chatbot.service.run_finance_consultant_graph",
        fake_run_finance_consultant_graph,
    )

    result = await financial_router.run_financial_chat(
        messages=[
            ChatMessage(
                role="user",
                content="Explain the electrical panel upgrade complication.",
            )
        ],
        county="Contra Costa County",
        adu_sqft=600,
        adu_type="detached",
        stored_finance_state={"complication_flags": {"electric_panel": True}},
    )

    assert result.route == "consultant"
    assert "[1]" in result.answer
    assert result.sources[0]["source"] == "Electrical guide"
    assert result.suggested_questions == ["How do I confirm this applies?"]


@pytest.mark.anyio
async def test_financial_chat_removes_mocked_consultant_internal_markers(
    monkeypatch,
):
    leaked_answer = (
        "This complication is included because of your property conditions "
        "[automatic_addons.1.trigger_reason]. "
        "The modeled range is [active_complications.1.display_range_text]."
    )

    async def fake_run_finance_consultant_graph(*args, **kwargs):
        return FinanceConsultantGraphResult(
            answer=leaked_answer,
            research_summary="Research summary",
            sources=[],
            suggested_questions=[],
        )

    monkeypatch.setattr(
        "financial_chatbot.service.run_finance_consultant_graph",
        fake_run_finance_consultant_graph,
    )

    result = await financial_router.run_financial_chat(
        messages=[
            ChatMessage(
                role="user",
                content="Why is this included in my estimate?",
            )
        ],
        county="Contra Costa County",
        adu_sqft=600,
        adu_type="detached",
    )

    assert "[automatic_addons.1.trigger_reason]" not in result.answer
    assert "[active_complications.1.display_range_text]" not in result.answer
    assert result.answer == (
        "This complication is included because of your property conditions. "
        "The modeled range is."
    )


@pytest.mark.anyio
async def test_financial_chat_normalizes_finance_citations(monkeypatch):
    async def fake_run_finance_consultant_graph(*args, **kwargs):
        return FinanceConsultantGraphResult(
            answer=(
                "Steel framing may cost more upfront [7, 8]. "
                "Prefabrication can reduce time [13]."
            ),
            research_summary="Research summary",
            sources=[
                {
                    "page_number": None,
                    "source": "Cost study",
                    "regulation_topic": "costs",
                    "chunk_text": "Steel framing can cost more than wood framing.",
                    "url": "https://example.com/cost-study",
                },
                {
                    "page_number": None,
                    "source": "Design guide",
                    "regulation_topic": "design",
                    "chunk_text": "Project costs vary based on local conditions.",
                    "url": "https://example.com/design-guide",
                },
                {
                    "page_number": None,
                    "source": "Prefab guide",
                    "regulation_topic": "schedule",
                    "chunk_text": "Prefabrication can shorten construction schedules.",
                    "url": "https://example.com/prefab-guide",
                },
                {
                    "page_number": None,
                    "source": "Permitting guide",
                    "regulation_topic": "permits",
                    "chunk_text": "Pre-approved plans can reduce permit friction.",
                    "url": "https://example.com/permits",
                },
                {
                    "page_number": None,
                    "source": "Open plan guide",
                    "regulation_topic": "layout",
                    "chunk_text": "Open floor plans may reduce framing complexity.",
                    "url": "https://example.com/open-plan",
                },
                {
                    "page_number": None,
                    "source": "Unused extra source",
                    "regulation_topic": "misc",
                    "chunk_text": "Unused source text.",
                    "url": "https://example.com/unused",
                },
                {
                    "page_number": None,
                    "source": "Steel comparison",
                    "regulation_topic": "costs",
                    "chunk_text": "Steel framing costs can vary by project.",
                    "url": "https://example.com/steel-comparison",
                },
                {
                    "page_number": None,
                    "source": "Insurance analysis",
                    "regulation_topic": "costs",
                    "chunk_text": "Insurance costs can influence total project economics.",
                    "url": "https://example.com/insurance-analysis",
                },
            ],
            suggested_questions=["What about timelines?"],
        )

    monkeypatch.setattr(
        "financial_chatbot.service.run_finance_consultant_graph",
        fake_run_finance_consultant_graph,
    )

    result = await financial_router.run_financial_chat(
        messages=[ChatMessage(role="user", content="Compare framing options.")],
        county="Contra Costa County",
        adu_sqft=600,
        adu_type="detached",
        stored_finance_state={},
    )

    assert (
        result.answer
        == "Steel framing may cost more upfront [1][2]. Prefabrication can reduce time."
    )
    assert [source["source"] for source in result.sources] == [
        "Steel comparison",
        "Insurance analysis",
    ]


class FakeSession:
    def __enter__(self):
        return object()

    def __exit__(self, exc_type, exc, tb):
        return False


@pytest.mark.anyio
async def test_calculator_endpoint_rejects_anonymous_saved_project_access():
    with pytest.raises(financial_router.HTTPException) as exc_info:
        financial_router.calculator_endpoint(
            CalculatorRequest(project_id="project-123"),
            current_user=None,
        )

    assert exc_info.value.status_code == 401


@pytest.mark.anyio
async def test_calculator_endpoint_ignores_project_scope(monkeypatch):
    captured_kwargs: dict | None = None
    fake_user = SimpleNamespace(id="user-123")

    def fake_calculate_finance_snapshot(**kwargs):
        nonlocal captured_kwargs
        captured_kwargs = kwargs
        finance_state = FinanceStateSnapshot()
        return finance_state, build_finance_presentation(finance_state)

    monkeypatch.setattr(
        financial_router,
        "calculate_finance_snapshot",
        fake_calculate_finance_snapshot,
    )

    response = financial_router.calculator_endpoint(
        CalculatorRequest(project_id="project-123"),
        current_user=fake_user,
    )

    assert captured_kwargs is not None
    assert "current_user_id" not in captured_kwargs
    assert "persist_finance_state" not in captured_kwargs
    assert "project_id" not in captured_kwargs
    assert response.report_synced is False


@pytest.mark.anyio
async def test_orchestrate_stream_rejects_anonymous_saved_project_access(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")

    with pytest.raises(orchestrator_router.HTTPException) as exc_info:
        await orchestrator_router.orchestrate_stream(
            OrchestratorRequest(message="SYSTEM_RESUME_CHAT", project_id="project-123"),
            current_user=None,
        )

    assert exc_info.value.status_code == 401


@pytest.mark.anyio
async def test_calculator_endpoint_allows_authenticated_request_without_project_scope(
    monkeypatch,
):
    response = financial_router.calculator_endpoint(
        CalculatorRequest(
            county="Contra Costa County",
            adu_sqft=600,
            adu_type="detached",
        ),
        current_user=TEST_USER,
    )

    assert response.presentation.base_estimate_range is not None


@pytest.mark.anyio
async def test_hydrate_project_node_skips_project_hydration_without_user_scope(
    monkeypatch,
):
    client_state = build_stored_state()
    monkeypatch.setattr(db_core, "SessionLocal", lambda: FakeSession())

    def fail_if_called(*args, **kwargs):
        raise AssertionError("Project lookup should be skipped without user scope")

    monkeypatch.setattr(ReportRepository, "get_project", fail_if_called)

    state = {
        "request": OrchestratorRequest(
            message="Explain HOA costs.",
            project_id="project-123",
            finance_state=client_state,
        ),
        "route": "",
        "response": None,
        "answer_safe_context": "",
        "internal_context": "",
        "finance_state": client_state,
        "finance_report_synced": False,
        "is_new_session": False,
        "welcome_summary": None,
        "current_user_id": None,
    }

    result = await orchestrator_graph.hydrate_project_node(state)

    assert result["answer_safe_context"] == ""
    assert result["internal_context"] == ""
    assert result["finance_state"] == client_state


@pytest.mark.anyio
async def test_hydrate_project_node_keeps_client_finance_state_without_project():
    client_state = build_stored_state()
    state = {
        "request": OrchestratorRequest(
            message="Explain electrical panel upgrade.",
            finance_state=client_state,
        ),
        "route": "",
        "response": None,
        "answer_safe_context": "",
        "internal_context": "",
        "finance_state": client_state,
        "finance_report_synced": False,
        "is_new_session": False,
        "welcome_summary": None,
    }

    result = await orchestrator_graph.hydrate_project_node(state)

    assert result["finance_state"] == client_state


@pytest.mark.anyio
async def test_hydrate_project_node_prefers_client_finance_state(monkeypatch):
    client_state = build_stored_state()
    project_state = {
        "complication_flags": {"hoa_restrictions": True},
    }
    project = SimpleNamespace(
        id="project-123",
        finance_state=project_state,
        address=None,
        county=None,
        property_area_sqft=None,
        buildable_area_sqft=None,
        setback_ft=None,
        max_adu_sqft=None,
        adu_sqft=None,
        adu_type=None,
        primary_use=None,
        fire_hazard_severity=None,
        fire_hazard_zone_type=None,
        blocker_types=[],
    )

    monkeypatch.setattr(db_core, "SessionLocal", lambda: FakeSession())
    monkeypatch.setattr(
        ReportRepository,
        "get_project",
        lambda db, project_id, user_id=None: project,
    )
    monkeypatch.setattr(
        ReportRepository,
        "get_report_by_project",
        lambda db, project_id, user_id=None: None,
    )

    state = {
        "request": OrchestratorRequest(
            message="Explain HOA costs.",
            project_id="project-123",
            finance_state=client_state,
        ),
        "route": "",
        "response": None,
        "answer_safe_context": "",
        "internal_context": "",
        "finance_state": client_state,
        "finance_report_synced": False,
        "is_new_session": False,
        "welcome_summary": None,
        "current_user_id": "user-123",
    }

    result = await orchestrator_graph.hydrate_project_node(state)

    assert result["finance_state"] == client_state


@pytest.mark.anyio
async def test_hydrate_project_node_falls_back_to_project_finance_state(monkeypatch):
    project_state = {
        "complication_flags": {"hoa_restrictions": True},
    }
    project = SimpleNamespace(
        id="project-123",
        finance_state=project_state,
        address=None,
        county=None,
        property_area_sqft=None,
        buildable_area_sqft=None,
        setback_ft=None,
        max_adu_sqft=None,
        adu_sqft=None,
        adu_type=None,
        primary_use=None,
        fire_hazard_severity=None,
        fire_hazard_zone_type=None,
        blocker_types=[],
    )

    monkeypatch.setattr(db_core, "SessionLocal", lambda: FakeSession())
    monkeypatch.setattr(
        ReportRepository,
        "get_project",
        lambda db, project_id, user_id=None: project,
    )
    monkeypatch.setattr(
        ReportRepository,
        "get_report_by_project",
        lambda db, project_id, user_id=None: None,
    )

    state = {
        "request": OrchestratorRequest(
            message="Explain HOA costs.",
            project_id="project-123",
            finance_state=None,
        ),
        "route": "",
        "response": None,
        "answer_safe_context": "",
        "internal_context": "",
        "finance_state": None,
        "finance_report_synced": False,
        "is_new_session": False,
        "welcome_summary": None,
        "current_user_id": "user-123",
    }

    result = await orchestrator_graph.hydrate_project_node(state)

    assert result["finance_state"] == project_state


@pytest.mark.anyio
async def test_hydrate_project_node_uses_project_data_without_reading_report(
    monkeypatch,
):
    client_state = build_finance_state(
        stored_finance_state=build_stored_state(),
        address="2263 Rosemount Ln",
        county="Contra Costa County",
        adu_sqft=600,
        adu_type="detached",
        fire_hazard_severity="Moderate",
        fire_hazard_zone_type="LRA",
    ).model_dump(mode="json")
    project = SimpleNamespace(
        id="project-123",
        finance_state={"complication_flags": {"hoa_restrictions": True}},
        address="2263 Rosemount Ln",
        county="Contra Costa County",
        property_area_sqft=None,
        buildable_area_sqft=None,
        setback_ft=None,
        max_adu_sqft=None,
        adu_sqft=None,
        adu_type=None,
        primary_use=None,
        fire_hazard_severity=None,
        fire_hazard_zone_type=None,
        blocker_types=[],
    )
    monkeypatch.setattr(db_core, "SessionLocal", lambda: FakeSession())
    monkeypatch.setattr(
        ReportRepository,
        "get_project",
        lambda db, project_id, user_id=None: project,
    )
    monkeypatch.setattr(
        ReportRepository,
        "get_report_by_project",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError("Chat hydration must not read reports")
        ),
    )

    state = {
        "request": OrchestratorRequest(
            message="SYSTEM_RESUME_CHAT",
            project_id="project-123",
            finance_state=client_state,
        ),
        "route": "",
        "response": None,
        "answer_safe_context": "",
        "internal_context": "",
        "finance_state": client_state,
        "finance_report_synced": False,
        "is_new_session": True,
        "welcome_summary": None,
        "current_user_id": "user-123",
    }

    result = await orchestrator_graph.hydrate_project_node(state)

    assert "2263 Rosemount Ln" in result["answer_safe_context"]
    assert "financial_snapshot" not in result["answer_safe_context"]


@pytest.mark.anyio
async def test_financial_agent_node_returns_finance_state_in_response(monkeypatch):
    client_state = build_stored_state()
    updated_state = FinanceStateSnapshot(adu_sqft=600)
    updated_state.complication_flags.electric_panel = True

    async def fake_run_financial_chat(*, stored_finance_state=None, **kwargs):
        assert stored_finance_state == client_state
        return FinancialChatResult(
            answer="Updated estimate",
            sources=[],
            suggested_questions=[],
            finance_state=updated_state,
            presentation=build_finance_presentation(updated_state),
            route="consultant",
        )

    monkeypatch.setattr(
        orchestrator_graph, "run_financial_chat", fake_run_financial_chat
    )

    state = {
        "request": OrchestratorRequest(
            message="Explain electrical panel upgrade.",
            finance_state=client_state,
        ),
        "route": "ROUTE_FINANCE",
        "response": None,
        "answer_safe_context": "",
        "internal_context": "",
        "finance_state": client_state,
        "finance_report_synced": False,
        "is_new_session": False,
        "welcome_summary": None,
        "current_user_id": None,
    }

    result = await orchestrator_graph.financial_agent_node(state)

    assert result["response"].finance_state == updated_state.model_dump(mode="json")
    assert result["finance_state"] == updated_state.model_dump(mode="json")
    assert result["response"].model_dump() == {
        "answer": "Updated estimate",
        "sources": [],
        "finance_state": updated_state.model_dump(mode="json"),
    }
