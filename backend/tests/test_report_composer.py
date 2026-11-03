"""Tests for the deterministic report composition helpers.

These functions read project/extraction inputs purely via ``getattr`` and emit
fixed prose/markdown, so ``SimpleNamespace`` stand-ins fully exercise them.
"""

from types import SimpleNamespace

from api.report_composer import (
    build_budget_recommendation,
    build_executive_summary,
    build_executive_summary_assessment_template,
    build_executive_summary_review_template,
    build_recommendations,
    build_recommendations_advance_template,
    build_recommendations_permitting_template,
    choose_seeded_template,
    EXECUTIVE_SUMMARY_TEMPLATES,
    RECOMMENDATIONS_TEMPLATES,
    build_notable_signals,
    build_project_descriptor,
    build_property_overview,
    build_requirement_open_items,
    build_site_review_recommendation,
    build_use_case_recommendation,
    build_zoning_advisory_bullets,
    build_zoning_analysis,
    compose_report_from_project,
    dedupe_text,
    format_feet,
    format_label,
    format_sqft,
    get_blockers,
    get_list_field,
    get_location,
    join_human_list,
    merge_keyed_dict_list,
)
from api.report_requirements import REQUIREMENT_QUESTIONS


# ---------------------------------------------------------------------------
# Small formatting primitives
# ---------------------------------------------------------------------------


def test_format_sqft_truncates_and_adds_thousands_separator():
    assert format_sqft(1234567.9) == "1,234,567 sq ft"


def test_format_sqft_none_returns_none():
    assert format_sqft(None) is None


def test_format_feet_truncates_to_int():
    assert format_feet(4.9) == "4 ft"
    assert format_feet(None) is None


def test_format_label_humanizes_snake_case():
    assert format_label("detached_unit") == "Detached Unit"


def test_format_label_falsy_returns_none():
    assert format_label(None) is None
    assert format_label("") is None


# ---------------------------------------------------------------------------
# Text utilities
# ---------------------------------------------------------------------------


def test_dedupe_text_collapses_whitespace_and_is_case_insensitive():
    result = dedupe_text(["  Foo   bar ", "foo bar", "", "   ", "Baz"])

    assert result == ["Foo bar", "Baz"]


def test_join_human_list_handles_zero_one_two_and_many():
    assert join_human_list([]) == ""
    assert join_human_list(["a"]) == "a"
    assert join_human_list(["a", "b"]) == "a and b"
    assert join_human_list(["a", "b", "c"]) == "a, b, and c"


def test_get_blockers_filters_blanks_and_casts_to_str():
    project = SimpleNamespace(blocker_types=["utility tie-in", "  ", "", "access"])

    assert get_blockers(project) == ["utility tie-in", "access"]


def test_get_blockers_missing_attribute_returns_empty():
    assert get_blockers(SimpleNamespace()) == []


def test_get_list_field_handles_none_and_non_list():
    assert get_list_field(None, "open_questions") == []
    assert (
        get_list_field(SimpleNamespace(open_questions="not-a-list"), "open_questions")
        == []
    )


def test_get_list_field_dedupes_list_values():
    extraction = SimpleNamespace(open_questions=["Budget?", "budget?", "Timeline?"])

    assert get_list_field(extraction, "open_questions") == ["Budget?", "Timeline?"]


def test_get_location_prefers_address_then_falls_back():
    assert get_location(SimpleNamespace(address="123 Main St")) == "123 Main St"
    assert get_location(SimpleNamespace(address=None)) == "this property"


# ---------------------------------------------------------------------------
# merge_keyed_dict_list
# ---------------------------------------------------------------------------


def test_merge_keyed_dict_list_overlay_replaces_and_preserves_order():
    existing = [{"id": "a", "v": 1}, {"id": "b", "v": 2}]
    overlay = [{"id": "a", "v": 9}, {"id": "c", "v": 3}]

    merged = merge_keyed_dict_list(existing, overlay, key="id")

    assert merged == [
        {"id": "a", "v": 9},
        {"id": "b", "v": 2},
        {"id": "c", "v": 3},
    ]


def test_merge_keyed_dict_list_passes_through_keyless_and_non_dict_items():
    existing = [{"id": "a", "v": 1}, "loose-string"]
    overlay = [{"v": "no-key"}]

    merged = merge_keyed_dict_list(existing, overlay, key="id")

    assert merged[0] == {"id": "a", "v": 1}
    assert "loose-string" in merged
    assert {"v": "no-key"} in merged


# ---------------------------------------------------------------------------
# Descriptor / recommendation builders
# ---------------------------------------------------------------------------


def test_build_project_descriptor_combines_size_and_type():
    project = SimpleNamespace(adu_sqft=800, adu_type="detached")

    assert build_project_descriptor(project) == "the planned 800 sq ft Detached ADU"


def test_build_project_descriptor_size_only():
    project = SimpleNamespace(adu_sqft=1200, adu_type=None)

    assert build_project_descriptor(project) == "the planned 1,200 sq ft ADU"


def test_build_project_descriptor_falls_back_when_empty():
    assert build_project_descriptor(SimpleNamespace()) == "the ADU project"


def test_build_budget_recommendation_reflects_existing_estimate():
    with_estimate = SimpleNamespace(
        finance_state={"base_estimate_range": {"low": 1, "high": 2}}
    )
    without = SimpleNamespace(finance_state={})

    assert (
        "preliminary cost estimate as a working budget baseline"
        in build_budget_recommendation(with_estimate)
    )
    assert "Establish a preliminary cost estimate" in build_budget_recommendation(
        without
    )


def test_build_site_review_recommendation_prioritizes_fire_hazard_template():
    project = SimpleNamespace(
        blocker_types=["sewer connection"],
        fire_hazard_severity="Moderate",
    )

    result = build_site_review_recommendation(project, ["drainage", "tree removal"])

    assert "Moderate fire hazard zone compliance" in result
    assert "6 ft minimum property setback requirement" in result


def test_build_site_review_recommendation_uses_tentative_unknown_fire_wording():
    project = SimpleNamespace(
        blocker_types=["sewer connection"],
        fire_hazard_severity="Unknown",
    )

    result = build_site_review_recommendation(project, ["drainage", "tree removal"])

    assert "confirming fire hazard status" in result
    assert "Unknown fire hazard zone compliance" not in result
    assert "6 ft minimum property setback requirement" in result


def test_build_site_review_recommendation_includes_concerns_and_blockers():
    project = SimpleNamespace(
        blocker_types=["sewer connection"], fire_hazard_severity=None
    )

    result = build_site_review_recommendation(project, ["drainage", "tree removal"])

    assert "drainage" in result
    assert "sewer connection" in result
    assert "6 ft minimum property setback requirement" in result


def test_build_site_review_recommendation_uses_default_when_empty():
    project = SimpleNamespace(blocker_types=[], fire_hazard_severity=None)

    result = build_site_review_recommendation(project, [])

    assert "access, grading, utility tie-ins" in result
    assert "6 ft minimum property setback requirement" in result


def test_build_use_case_recommendation_matches_design_priorities_copy():
    project = SimpleNamespace(primary_use="long-term rental")
    extraction = SimpleNamespace(explicit_preferences=["natural light"])

    result = build_use_case_recommendation(project, extraction)

    assert "non-negotiable design priorities" in result
    assert "avoid costly revisions" in result


def test_build_recommendations_advance_template_matches_expected_copy():
    project = SimpleNamespace(
        address="2263 Rosemount Lane, San Ramon, California 94582",
        adu_sqft=258,
        adu_type="detached",
        county="Contra Costa County",
        fire_hazard_severity="Moderate",
        finance_state={"base_estimate_range": {"low": 1, "high": 2}},
    )

    text = build_recommendations_advance_template(project, None)

    assert "advance this project from feasibility into a permit-ready scope" in text
    assert "permit-ready package including a site plan" in text
    assert "working budget baseline" in text


def test_build_recommendations_permitting_template_matches_expected_copy():
    project = SimpleNamespace(
        address="2263 Rosemount Lane, San Ramon, California 94582",
        adu_sqft=258,
        adu_type="detached",
        county="Contra Costa County",
        fire_hazard_severity="Moderate",
        finance_state={"base_estimate_range": {"low": 1, "high": 2}},
    )

    text = build_recommendations_permitting_template(project, None)

    assert "from feasibility into permitting" in text
    assert "complete permit submittal package" in text
    assert "starting point" in text
    assert "Moderate fire hazard zone standards" in text
    assert "Contra Costa County ADU approvals" in text
    assert "minimize change orders and cost overruns" in text


def test_build_recommendations_is_stable_for_project_id():
    project = SimpleNamespace(
        id="11111111-2222-3333-4444-555555555555",
        address="2263 Rosemount Lane, San Ramon, California 94582",
        adu_sqft=258,
        adu_type="detached",
    )

    first = build_recommendations(project, None)
    second = build_recommendations(project, None)

    assert first == second


def test_choose_seeded_recommendations_template_is_stable_per_section():
    project = SimpleNamespace(id="same-project-id")

    rec_first = choose_seeded_template(
        project,
        section="recommendations",
        templates=RECOMMENDATIONS_TEMPLATES,
    )
    rec_second = choose_seeded_template(
        project,
        section="recommendations",
        templates=RECOMMENDATIONS_TEMPLATES,
    )
    exec_first = choose_seeded_template(
        project,
        section="executive_summary",
        templates=EXECUTIVE_SUMMARY_TEMPLATES,
    )

    assert rec_first is rec_second
    assert rec_first in RECOMMENDATIONS_TEMPLATES
    assert exec_first in EXECUTIVE_SUMMARY_TEMPLATES


# ---------------------------------------------------------------------------
# Section builders
# ---------------------------------------------------------------------------


def test_build_executive_summary_assessment_template():
    summary = build_executive_summary_assessment_template(
        "17842 Arvida Drive, Granada Hills, California 91344",
        "553 sq ft Detached ADU",
    )

    assert "feasibility assessment for the proposed 553 sq ft Detached ADU" in summary
    assert "17842 Arvida Drive, Granada Hills, California 91344" in summary
    assert "No significant regulatory or structural blockers" in summary
    assert "preliminarily assessed as feasible" in summary
    assert "Final approval remains pending verification" in summary
    assert summary.count("\n\n") == 1


def test_build_executive_summary_review_template():
    summary = build_executive_summary_review_template(
        "2262 Rosemount Lane, San Ramon, California 94582",
        "264 sq ft Detached ADU",
    )

    assert (
        "feasibility review has been completed for the proposed 264 sq ft Detached ADU"
        in summary
    )
    assert "2262 Rosemount Lane, San Ramon, California 94582" in summary
    assert "preliminarily viable" in summary
    assert "no major regulatory or structural obstacles" in summary
    assert "For next steps review the 'Recommendations' section" in summary


def test_build_executive_summary_includes_shape_in_adu_phrase():
    project = SimpleNamespace(
        id="shape-test-project-id",
        address="123 Main St, Irvine",
        adu_sqft=750,
        adu_type="detached",
        adu_shape="l-shape",
    )

    summary = build_executive_summary(project)

    assert "750 sq ft L-Shape Detached ADU" in summary


def test_build_executive_summary_is_stable_for_project_id():
    project = SimpleNamespace(
        id="11111111-2222-3333-4444-555555555555",
        address="17842 Arvida Drive, Granada Hills, California 91344",
        adu_sqft=553,
        adu_type="detached",
    )

    first = build_executive_summary(project)
    second = build_executive_summary(project)

    assert first == second


def test_choose_seeded_template_is_stable_per_section():
    project = SimpleNamespace(id="same-project-id")

    exec_first = choose_seeded_template(
        project,
        section="executive_summary",
        templates=EXECUTIVE_SUMMARY_TEMPLATES,
    )
    exec_second = choose_seeded_template(
        project,
        section="executive_summary",
        templates=EXECUTIVE_SUMMARY_TEMPLATES,
    )
    rec_first = choose_seeded_template(
        project,
        section="recommendations",
        templates=RECOMMENDATIONS_TEMPLATES,
    )

    assert exec_first is exec_second
    assert exec_first in EXECUTIVE_SUMMARY_TEMPLATES
    assert rec_first in RECOMMENDATIONS_TEMPLATES


def test_build_executive_summary_uses_fallbacks():
    project = SimpleNamespace(
        id="fallback-test-project-id",
        address=None,
        adu_sqft=None,
        adu_type=None,
        blocker_types=[],
    )

    summary = build_executive_summary(project)

    assert "this property" in summary
    assert "proposed ADU" in summary
    assert (
        "preliminarily assessed as feasible" in summary
        or "preliminarily viable" in summary
    )


def test_build_property_overview_empty_project_returns_placeholder():
    project = SimpleNamespace()

    assert "have not been saved yet" in build_property_overview(project)


def test_build_property_overview_renders_markdown_table_for_filled_fields():
    project = SimpleNamespace(
        address="123 Main St",
        property_area_sqft=6000,
        adu_sqft=800,
        adu_width_ft=20.0,
        adu_length_ft=40.0,
        adu_shape="rectangle",
        primary_use="home office",
    )

    overview = build_property_overview(project)

    assert "| Field | Current value |" in overview
    assert "| Address | 123 Main St |" in overview
    assert "| Property area | 6,000 sq ft |" in overview
    assert "| ADU dimensions | 20.0 x 40.0 ft |" in overview
    assert "Primary planned use: home office." in overview


def test_build_property_overview_explains_non_rectangular_dimensions():
    project = SimpleNamespace(
        adu_width_ft=10.5,
        adu_length_ft=34.9,
        adu_shape="l-shape",
    )

    overview = build_property_overview(project)

    assert "| Overall footprint* | 10.5 x 34.9 ft |" in overview
    assert "Current ADU clearances" not in overview
    assert (
        "*Overall footprint describes the full outer width and depth of the L-Shape ADU"
        in overview
    )
    assert "not each individual leg" in overview


def test_build_zoning_analysis_defaults_to_unknown_fire_hazard():
    project = SimpleNamespace()

    analysis = build_zoning_analysis(project)

    assert analysis.splitlines()[0] == (
        "- Fire hazard zone: Unknown — confirm this in chat for a more accurate "
        "wildfire-safety scope and cost estimate."
    )


def test_build_zoning_analysis_matches_template_structure():
    project = SimpleNamespace(
        max_adu_sqft=1200,
        adu_sqft=258,
        setback_ft=4,
        county="Contra Costa County",
        fire_hazard_severity="Moderate",
        adu_clearances=[
            {
                "direction": "top",
                "target_kind": "parcel-boundary",
                "distance_feet": 4.9,
            },
            {
                "direction": "right",
                "target_kind": "active-structure",
                "distance_feet": 7.6,
                "target_structure_index": 1,
            },
            {
                "direction": "bottom",
                "target_kind": "parcel-boundary",
                "distance_feet": 41.1,
            },
            {
                "direction": "left",
                "target_kind": "parcel-boundary",
                "distance_feet": 5.1,
            },
        ],
    )

    analysis = build_zoning_analysis(project)
    first_line = analysis.splitlines()[0]

    assert first_line == (
        "- Fire hazard zone: Moderate — fire-resilient materials and safety upgrades "
        "may be required."
    )

    assert (
        "- The permitted ADU size for this property ranges from 200 sq ft to 1,200 sq ft — "
        "the proposed unit is within compliance."
    ) in analysis
    assert (
        "- The required minimum parcel setback is set at 4 ft on all applicable sides."
        in analysis
    )
    assert (
        "- The required minimum property setback for fire safety is set at 6 ft "
        "on all applicable sides."
    ) in analysis
    assert (
        "- Current placement clearances: Top 4.9 ft to parcel · Right 7.6 ft to Structure #1 · "
        "Bottom 41.1 ft to parcel · Left 5.1 ft to parcel — all clearances are within range of the minimums."
    ) in analysis
    assert (
        "- All zoning parameters and clearances should be confirmed with the "
        "Contra Costa County planning department or other such local agency prior to permit drawings or "
        "contractor pricing."
    ) in analysis


def test_build_zoning_analysis_explains_unknown_fire_hazard_first():
    project = SimpleNamespace(max_adu_sqft=1200, adu_sqft=800)

    analysis = build_zoning_analysis(project)
    first_line = analysis.splitlines()[0]

    assert first_line == (
        "- Fire hazard zone: Unknown — confirm this in chat for a more accurate "
        "wildfire-safety scope and cost estimate."
    )


def test_build_zoning_analysis_explains_no_designated_fire_hazard_first():
    project = SimpleNamespace(fire_hazard_severity="None", max_adu_sqft=1200)

    analysis = build_zoning_analysis(project)

    assert analysis.splitlines()[0] == (
        "- Fire hazard zone: None — no designated fire hazard zone is currently "
        "saved for this property."
    )


def test_build_zoning_analysis_explains_high_fire_hazard_first():
    project = SimpleNamespace(fire_hazard_severity="High", max_adu_sqft=1200)

    analysis = build_zoning_analysis(project)

    assert analysis.splitlines()[0] == (
        "- Fire hazard zone: High — fire-resilient materials and safety upgrades "
        "may be required."
    )


def test_build_zoning_analysis_explains_very_high_fire_hazard_first():
    project = SimpleNamespace(fire_hazard_severity="Very High", max_adu_sqft=1200)

    analysis = build_zoning_analysis(project)

    assert analysis.splitlines()[0] == (
        "- Fire hazard zone: Very High — plan for stronger wildfire-compliance "
        "requirements and confirm details with the local jurisdiction."
    )


def test_build_zoning_analysis_flags_oversized_proposed_adu():
    project = SimpleNamespace(max_adu_sqft=800, adu_sqft=950)

    analysis = build_zoning_analysis(project)

    assert "exceeds the permitted maximum" in analysis


def test_build_zoning_analysis_flags_clearances_below_minimums():
    project = SimpleNamespace(
        setback_ft=4,
        adu_clearances=[
            {
                "direction": "top",
                "target_kind": "parcel-boundary",
                "distance_feet": 3.5,
            }
        ],
    )

    analysis = build_zoning_analysis(project)

    assert (
        "one or more clearances should be reviewed against the minimum setbacks"
        in analysis
    )


def test_build_notable_signals_merges_and_dedupes():
    project = SimpleNamespace(
        fire_hazard_severity="Moderate",
        blocker_types=["sewer"],
    )
    extraction = SimpleNamespace(
        conversation_highlights=["wants fast timeline", "wants fast timeline"],
        timeline_notes=["permit by fall"],
        budget_notes=[],
    )

    signals = build_notable_signals(project, extraction)

    assert signals.count("wants fast timeline") == 1
    assert "permit by fall" in signals
    assert "Saved fire hazard severity: Moderate" in signals
    assert "Saved potential blockers: sewer" in signals


def test_build_requirement_open_items_excludes_answered_questions():
    answered_id = REQUIREMENT_QUESTIONS[0]["id"]
    answered_title = REQUIREMENT_QUESTIONS[0]["title"]
    unanswered_title = REQUIREMENT_QUESTIONS[1]["title"]

    open_items = build_requirement_open_items(
        {"requirements": [{"id": answered_id}]},
        {},
    )

    assert all(not item.startswith(f"{answered_title}:") for item in open_items)
    assert any(item.startswith(f"{unanswered_title}:") for item in open_items)


def test_build_requirement_open_items_keeps_preexisting_context_items():
    open_items = build_requirement_open_items(
        {"requirements": []},
        {"requirement_open_items": ["Custom carry-over item"]},
    )

    assert "Custom carry-over item" in open_items


# ---------------------------------------------------------------------------
# End-to-end composition
# ---------------------------------------------------------------------------


def _project():
    return SimpleNamespace(
        address="123 Main St, Irvine",
        county="Orange County",
        property_area_sqft=6000,
        buildable_area_sqft=2000,
        setback_ft=4,
        max_adu_sqft=1200,
        adu_sqft=800,
        adu_type="detached",
        adu_shape="rectangle",
        current_yard_zone="rear",
        adu_clearances=None,
        primary_use="rental",
        fire_hazard_severity=None,
        fire_hazard_zone_type=None,
        blocker_types=["utility access"],
        finance_state=None,
    )


def test_compose_report_returns_expected_visible_and_context_keys():
    visible, context = compose_report_from_project(_project())

    assert set(visible) == {
        "executive_summary",
        "property_overview",
        "zoning_analysis",
        "financial_snapshot",
        "recommendations",
    }
    assert set(context) == {
        "key_questions",
        "implicit_preferences",
        "notable_signals",
    }
    assert "123 Main St, Irvine" in visible["executive_summary"]


def test_compose_report_overlay_requirements_win_over_existing():
    existing_report = SimpleNamespace(
        visible={"requirements": [{"id": "project_intent", "answer": "old"}]},
        context={},
    )
    overlay = {
        "visible": {"requirements": [{"id": "project_intent", "answer": "new"}]},
    }

    visible, _ = compose_report_from_project(
        _project(),
        existing_report=existing_report,
        preload_overlay=overlay,
        include_guided_requirements=True,
    )

    intents = [r for r in visible["requirements"] if r.get("id") == "project_intent"]
    assert len(intents) == 1
    assert intents[0]["answer"] == "new"


def test_zoning_advisory_bullets_attached_over_half():
    project = SimpleNamespace(adu_type="attached", adu_sqft=1000, home_sqft=1810)

    bullets = build_zoning_advisory_bullets(project)

    assert len(bullets) == 1
    assert "may exceed that" in bullets[0]


def test_zoning_advisory_bullets_attached_unknown_home():
    project = SimpleNamespace(adu_type="attached", adu_sqft=900, home_sqft=None)

    bullets = build_zoning_advisory_bullets(project)

    assert len(bullets) == 1
    assert "could not be verified" in bullets[0]


def test_zoning_advisory_bullets_silent_at_or_under_800():
    assert (
        build_zoning_advisory_bullets(
            SimpleNamespace(
                adu_type="attached", adu_sqft=800, current_yard_zone="Front"
            )
        )
        == []
    )


def test_zoning_advisory_bullets_front_yard_any_type():
    project = SimpleNamespace(
        adu_type="detached", adu_sqft=900, current_yard_zone="Front / Side"
    )

    bullets = build_zoning_advisory_bullets(project)

    assert len(bullets) == 1
    assert "front yard" in bullets[0]


def test_zoning_analysis_places_advisories_before_confirmation():
    project = SimpleNamespace(
        adu_type="attached",
        adu_sqft=900,
        home_sqft=None,
        current_yard_zone="Front",
        fire_hazard_severity="Moderate",
        county="Contra Costa County",
    )

    lines = build_zoning_analysis(project).split("\n")

    assert "living area" in lines[-3]
    assert "front yard" in lines[-2]
    assert "planning department" in lines[-1]
