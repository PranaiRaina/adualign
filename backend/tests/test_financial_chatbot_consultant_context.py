import json

from financial_chatbot.context import (
    build_consultant_complication_context,
    build_consultant_evidence_context,
    identify_modeled_complications_in_message,
)
from financial_chatbot.config import CONSULTANT_SYNTHESIS_PROMPT
from financial_chatbot.calculator import (
    bootstrap_base_estimate,
    build_modeled_complication_catalog,
    calculate_complication_amount,
    hydrate_finance_state,
    recompute_adjusted_estimate,
)


def build_finance_state():
    finance_state = hydrate_finance_state(
        None,
        address="2263 Rosemount Ln",
        county="Contra Costa County",
        adu_sqft=600,
        adu_type="detached",
        fire_hazard_severity="Very High",
        fire_hazard_zone_type="SRA",
    )
    finance_state.complication_flags.electric_panel = True
    finance_state = bootstrap_base_estimate(finance_state)
    return recompute_adjusted_estimate(finance_state)


def build_moderate_fire_finance_state():
    finance_state = hydrate_finance_state(
        None,
        address="2263 Rosemount Ln",
        county="Contra Costa County",
        adu_sqft=600,
        adu_type="detached",
        fire_hazard_severity="Moderate",
        fire_hazard_zone_type="LRA",
    )
    finance_state = bootstrap_base_estimate(finance_state)
    return recompute_adjusted_estimate(finance_state)


def test_build_modeled_complication_catalog_marks_included_and_ranges():
    catalog = build_modeled_complication_catalog(build_finance_state())
    by_key = {entry["key"]: entry for entry in catalog}

    assert by_key["electric_panel"]["is_currently_included"] is True
    assert by_key["electric_panel"]["authoritative_range_text"] == "$3,500 - $7,000"
    assert by_key["septic_tank"]["authoritative_range_text"] == "$5,000 - $20,000"
    assert by_key["slope"]["is_currently_included"] is False
    assert by_key["slope"]["authoritative_range_text"] == "$10,000 - $35,000"
    assert (
        by_key["hoa_restrictions"]["authoritative_range_text"] == "$15 - $35 per sqft"
    )
    assert by_key["solar_mandate"]["trigger_reason"] is not None
    assert by_key["fire_resilient_upgrades"]["is_currently_included"] is False


def test_build_modeled_complication_catalog_marks_moderate_fire_addon_included():
    catalog = build_modeled_complication_catalog(build_moderate_fire_finance_state())
    by_key = {entry["key"]: entry for entry in catalog}

    assert by_key["fire_resilient_upgrades"]["is_currently_included"] is True
    assert (
        by_key["fire_resilient_upgrades"]["authoritative_range_text"]
        == "$5,000 - $10,000 for fire-resilient materials and possible sprinkler-related upgrades"
    )
    assert by_key["fire_resilient_upgrades"]["trigger_reason"] is not None
    assert by_key["very_high_fire_risk"]["is_currently_included"] is False


def test_fixed_amount_complications_use_cost_model_midpoints():
    finance_state = build_finance_state()

    assert calculate_complication_amount("electric_panel", finance_state) == 5250.0
    assert calculate_complication_amount("septic_tank", finance_state) == 12500.0


def test_consultant_evidence_context_uses_stable_source_order():
    context = build_consultant_evidence_context(
        [
            {
                "source": "First source",
                "chunk_text": "First evidence snippet.",
                "url": "https://example.com/one",
            },
            {
                "source": "Second source",
                "chunk_text": "Second evidence snippet.",
                "url": "https://example.com/two",
            },
        ]
    )

    assert "[1] Title: First source" in context
    assert "[2] Title: Second source" in context
    assert context.index("[1] Title: First source") < context.index(
        "[2] Title: Second source"
    )


def test_identify_modeled_complications_in_message_matches_aliases():
    catalog = build_modeled_complication_catalog(build_finance_state())

    assert identify_modeled_complications_in_message(
        "Can the calculator account for an electrical panel upgrade?",
        catalog,
    ) == ["electric_panel"]
    assert identify_modeled_complications_in_message(
        "What about HOA restrictions and slope?",
        catalog,
    ) == ["slope", "hoa_restrictions"]


def test_build_consultant_complication_context_groups_supported_complications():
    context = json.loads(
        build_consultant_complication_context(
            finance_state=build_finance_state(),
            message="sure, tell me about other common complications",
        )
    )

    included = {
        entry["key"] for entry in context["currently_included_modeled_complications"]
    }
    not_included = {
        entry["key"]
        for entry in context["modeled_but_not_currently_included_complications"]
    }

    assert context["broad_complication_request"] is True
    assert "electric_panel" in included
    assert "solar_mandate" in included
    assert "slope" in not_included
    assert "demolition" in not_included


def test_build_consultant_complication_context_marks_specific_modeled_mentions():
    context = json.loads(
        build_consultant_complication_context(
            finance_state=build_finance_state(),
            message="Can you explain the electrical panel upgrade complication?",
        )
    )

    assert context["broad_complication_request"] is False
    assert context["mentioned_modeled_complication_keys"] == ["electric_panel"]


def test_consultant_synthesis_prompt_forbids_payload_leaks_and_requires_plain_english():
    assert "Never mention internal JSON keys" in CONSULTANT_SYNTHESIS_PROMPT
    assert "Never output bracket-style placeholders or path-like references" in (
        CONSULTANT_SYNTHESIS_PROMPT
    )
    assert "automatic_addons" in CONSULTANT_SYNTHESIS_PROMPT
    assert "active_complications" in CONSULTANT_SYNTHESIS_PROMPT
    assert "trigger_reason" in CONSULTANT_SYNTHESIS_PROMPT
    assert "display_range_text" in CONSULTANT_SYNTHESIS_PROMPT
    assert "you must restate it in plain English only" in CONSULTANT_SYNTHESIS_PROMPT
    assert (
        "Describe inclusion status, trigger reasons, and modeled ranges in natural language"
        in (CONSULTANT_SYNTHESIS_PROMPT)
    )
