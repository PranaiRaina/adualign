"""Tests for footprint dimensions in chat/report hydration."""

from types import SimpleNamespace

from orchestrator.hydration import compose_answer_safe_context


def test_compose_answer_safe_context_supplements_missing_footprint_from_project():
    visible = {
        "executive_summary": "Feasible.",
        "property_overview": (
            "| Field | Current value |\n"
            "| --- | --- |\n"
            "| Planned ADU size | 800 sq ft |\n"
        ),
    }
    project = SimpleNamespace(
        adu_width_ft=20.0,
        adu_length_ft=40.0,
        adu_shape="rectangle",
    )

    context = compose_answer_safe_context(visible, project)

    assert "Property footprint (saved project data)" in context
    assert "ADU Footprint Dimensions: 20 x 40 ft" in context


def test_compose_answer_safe_context_skips_supplement_when_overview_has_dimensions():
    visible = {
        "property_overview": (
            "| Field | Current value |\n| ADU dimensions | 20.0 x 40.0 ft |\n"
        ),
    }
    project = SimpleNamespace(adu_width_ft=20.0, adu_length_ft=40.0)

    context = compose_answer_safe_context(visible, project)

    assert "Property footprint (saved project data)" not in context


def test_compose_answer_safe_context_uses_overall_footprint_label_for_l_shape():
    visible = {
        "property_overview": "| Field | Current value |\n| Planned ADU size | 800 sq ft |"
    }
    project = SimpleNamespace(
        adu_width_ft=10.5,
        adu_length_ft=34.9,
        adu_shape="l-shape",
    )

    context = compose_answer_safe_context(visible, project)

    assert "ADU Overall Footprint Dimensions: 10.5 x 34.9 ft" in context
    assert "outer bounding box" in context
