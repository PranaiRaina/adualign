from types import SimpleNamespace

import pytest
from langchain_core.documents import Document

import orchestrator.graph as orchestrator_graph
from RAG_pipeline.router import _build_frontend_context
from RAG_pipeline.graph.nodes.generator import build_instructions
from orchestrator.hydration import (
    compose_answer_safe_context,
    compose_internal_context,
    compose_property_context,
)
from orchestrator.schemas import OrchestratorRequest
from RAG_pipeline.schemas import ChatRequest


def test_compose_property_context_includes_county():
    project = SimpleNamespace(
        address="123 Main St",
        county="Orange County",
        property_area_sqft=None,
        buildable_area_sqft=None,
        setback_ft=None,
        max_adu_sqft=None,
        adu_sqft=None,
        adu_type=None,
        primary_use=None,
        current_yard_zone="Rear",
        adu_clearances=[
            {
                "direction": "top",
                "target_kind": "parcel-boundary",
                "distance_feet": 4.0,
            }
        ],
        blocker_types=[],
    )

    context = compose_property_context(project)

    assert "- County: Orange County" in context
    assert "- Current Yard Zone: Rear" in context
    assert "- ADU Clearances: top: 4.0 ft to property line" in context


def test_map_to_rag_state_includes_county():
    state = {
        "request": OrchestratorRequest(
            message="What are the setbacks?",
            county="Orange County",
            current_yard_zone="Rear",
            adu_clearances=[
                {
                    "direction": "left",
                    "target_kind": "active-structure",
                    "distance_feet": 6.0,
                    "target_structure_index": 2,
                }
            ],
        ),
        "answer_safe_context": "",
        "internal_context": "",
    }

    rag_state = orchestrator_graph.map_to_rag_state(state)

    assert rag_state["frontend_context"]["county"] == "Orange County"
    assert rag_state["frontend_context"]["current_yard_zone"] == "Rear"
    assert rag_state["frontend_context"]["adu_clearances"] == [
        {
            "direction": "left",
            "target_kind": "active-structure",
            "distance_feet": 6.0,
            "target_structure_index": 2,
        }
    ]


def test_build_frontend_context_includes_yard_zone_and_clearances():
    frontend_context = _build_frontend_context(
        ChatRequest(
            message="What can I build here?",
            current_yard_zone="Rear / Side",
            adu_clearances=[
                {
                    "direction": "bottom",
                    "target_kind": "parcel-boundary",
                    "distance_feet": 4.5,
                }
            ],
        )
    )

    assert frontend_context["current_yard_zone"] == "Rear / Side"
    assert frontend_context["adu_clearances"] == [
        {
            "direction": "bottom",
            "target_kind": "parcel-boundary",
            "distance_feet": 4.5,
            "target_structure_index": None,
        }
    ]


def test_build_instructions_includes_county():
    instructions = build_instructions(
        [Document(page_content="Detached ADUs need setbacks.", metadata={"id": "1"})],
        {
            "county": "Orange County",
            "current_yard_zone": "Rear",
            "adu_clearances": [
                {
                    "direction": "right",
                    "target_kind": "parcel-boundary",
                    "distance_feet": 4.0,
                }
            ],
        },
    )

    assert "- County: Orange County" in instructions
    assert "- Current Yard Zone: Rear" in instructions
    assert "- ADU Clearances: right: 4.0 ft to property line" in instructions


def test_backfill_request_from_project_includes_yard_zone_and_clearances():
    request = OrchestratorRequest(message="What are my setbacks?")
    project = SimpleNamespace(
        id="project-123",
        address=None,
        county=None,
        adu_sqft=None,
        adu_type=None,
        primary_use=None,
        fire_hazard_severity=None,
        fire_hazard_zone_type=None,
        current_yard_zone="Rear",
        adu_clearances=[
            {
                "direction": "top",
                "target_kind": "parcel-boundary",
                "distance_feet": 4.0,
            }
        ],
        blocker_types=[],
    )

    orchestrator_graph._backfill_request_from_project(request, project)

    assert request.current_yard_zone == "Rear"
    assert [
        clearance.model_dump(mode="json") for clearance in request.adu_clearances
    ] == [
        {
            "direction": "top",
            "target_kind": "parcel-boundary",
            "distance_feet": 4.0,
            "target_structure_index": None,
        }
    ]


@pytest.mark.anyio
async def test_financial_agent_node_passes_county(monkeypatch):
    captured: dict[str, str | None] = {}

    async def fake_run_financial_chat(
        *,
        messages,
        address=None,
        county=None,
        adu_sqft=None,
        answer_safe_context=None,
        **kwargs,
    ):
        captured["county"] = county
        return SimpleNamespace(
            answer="ok",
            sources=[],
            finance_state=SimpleNamespace(model_dump=lambda mode="json": {}),
            report_synced=False,
        )

    monkeypatch.setattr(
        orchestrator_graph,
        "run_financial_chat",
        fake_run_financial_chat,
    )

    state = {
        "request": OrchestratorRequest(
            message="How much will it cost?",
            county="Orange County",
        ),
        "answer_safe_context": "",
        "internal_context": "",
        "response": None,
        "finance_state": None,
    }

    result = await orchestrator_graph.financial_agent_node(state)

    assert captured["county"] == "Orange County"
    assert result["response"].answer == "ok"


def test_compose_answer_safe_context_excludes_hidden_sections():
    answer_safe_context = compose_answer_safe_context(
        {"executive_summary": "Visible summary"}
    )

    assert "Visible summary" in answer_safe_context
    assert "Implicit Preferences" not in answer_safe_context
    assert "NOT SHOWN TO USER" not in answer_safe_context


def test_compose_internal_context_keeps_hidden_sections():
    internal_context = compose_internal_context(
        {"implicit_preferences": ["Prefers low upfront cost."]}
    )

    assert "Implicit Preferences" in internal_context
    assert "Prefers low upfront cost." in internal_context
