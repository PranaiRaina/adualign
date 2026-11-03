from typing import cast

from api.report_sanitizer import (
    sanitize_report_context_fields,
    sanitize_report_text,
    sanitize_report_visible_fields,
)
from financial_chatbot.reporting import build_financial_snapshot
from financial_chatbot.schemas import ManualComplicationSelections
from financial_chatbot.service import build_finance_state


def test_sanitize_report_text_removes_bracket_citations():
    text = "Loans can help fund an ADU [11]. Grants may also apply [2][3]."

    sanitized_text = sanitize_report_text(text)

    assert sanitized_text == "Loans can help fund an ADU. Grants may also apply."


def test_sanitize_report_text_removes_footnotes_and_definitions():
    text = (
        "Programs may reduce upfront costs [^1].\n\n[^1]: https://example.com/program\n"
    )

    sanitized_text = sanitize_report_text(text)

    assert sanitized_text == "Programs may reduce upfront costs."


def test_sanitize_report_text_keeps_non_numeric_brackets():
    text = "Compare plan [A] with option [B] before deciding."

    sanitized_text = sanitize_report_text(text)

    assert sanitized_text == text


def test_sanitize_report_visible_fields_cleans_section_text():
    visible_fields = {
        "financial_snapshot": "Construction financing [10, 11, 12] may help.",
        "recommendations": "Review lender terms [4].",
    }

    sanitized_fields = sanitize_report_visible_fields(visible_fields)

    assert sanitized_fields == {
        "financial_snapshot": "Construction financing may help.",
        "recommendations": "Review lender terms.",
    }


def test_sanitize_report_text_converts_html_lists_to_markdown_bullets():
    text = (
        "Next steps:<ul><li>Confirm setbacks with the site plan.</li>"
        "<li>Refresh the calculator estimate.</li></ul>"
    )

    sanitized_text = sanitize_report_text(text)

    assert sanitized_text == (
        "Next steps:\n- Confirm setbacks with the site plan.\n"
        "- Refresh the calculator estimate."
    )


def test_sanitize_report_text_converts_jammed_numbered_steps_to_bullets():
    text = (
        "Based on the feasibility review, here are the next steps:1. Confirm setbacks."
        "2. Refresh the budget.3. Verify utility capacity."
    )

    sanitized_text = sanitize_report_text(text)

    assert sanitized_text == (
        "Based on the feasibility review, here are the next steps:\n"
        "- Confirm setbacks.\n"
        "- Refresh the budget.\n"
        "- Verify utility capacity."
    )


def test_sanitize_report_text_preserves_currency_sentence_endings():
    text = (
        "$3,000 to $6,000. This is already reflected. "
        "$7,500 to $17,500. This may apply if septic work is needed."
    )

    sanitized_text = sanitize_report_text(text)

    assert sanitized_text == text


def test_sanitize_report_text_preserves_financial_snapshot_markdown():
    finance_state = build_finance_state(
        stored_finance_state=None,
        address="2263 Rosemount Ln",
        county="Contra Costa County",
        adu_sqft=600,
        adu_type="detached",
        fire_hazard_severity="Moderate",
        fire_hazard_zone_type="LRA",
        manual_complications=cast(
            ManualComplicationSelections,
            {"electric_panel": True},
        ),
    )
    snapshot = build_financial_snapshot(finance_state)

    sanitized_text = sanitize_report_text(snapshot)

    assert "$3,500 to $7,000" in sanitized_text
    assert "$7,000 to $12,000" in sanitized_text
    assert "$10,000 to $17,500" in sanitized_text
    assert "\n\n**Included in this estimate**\n" in sanitized_text
    assert "\n\n**Not currently included**\n" in sanitized_text


def test_sanitize_report_context_fields_cleans_list_items():
    context_fields = {
        "notable_signals": [
            "User asked about grants [7].",
            "Wants lower upfront costs [^1].",
        ]
    }

    sanitized_fields = sanitize_report_context_fields(context_fields)

    assert sanitized_fields == {
        "notable_signals": [
            "User asked about grants.",
            "Wants lower upfront costs.",
        ]
    }
