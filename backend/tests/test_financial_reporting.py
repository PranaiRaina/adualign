import os
from types import SimpleNamespace
from typing import cast

os.environ.setdefault(
    "SUPABASE_DATABASE_URL",
    "sqlite:///./test-financial-reporting.db",
)

from api.routers.reports import _build_report_input
from api.routers.schemas import GenerateStructuredReportRequest, HistoryMessage
from financial_chatbot.reporting import (
    build_financial_report_context,
    build_financial_snapshot,
)
from financial_chatbot.schemas import ManualComplicationSelections
from financial_chatbot.service import build_finance_state


def build_snapshot(*, include_electric_panel: bool = False):
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
            {"electric_panel": include_electric_panel},
        ),
    )
    return finance_state


def build_project(**overrides):
    defaults = {
        "address": "2263 Rosemount Ln",
        "property_area_sqft": None,
        "buildable_area_sqft": None,
        "setback_ft": None,
        "max_adu_sqft": None,
        "adu_sqft": 600,
        "adu_type": "detached",
        "adu_shape": None,
        "primary_use": "rental income",
        "current_yard_zone": "Rear",
        "adu_clearances": [],
        "blocker_types": [],
        "finance_state": None,
    }
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def test_build_financial_snapshot_lists_budget_addons_and_modeled_risks():
    report_text = build_financial_snapshot(build_snapshot(include_electric_panel=True))

    assert (
        "The current planning range for this ADU is **$257,356 to $386,034**."
        in report_text
    )
    assert "- **Base estimate range:** $216,160 to $324,240" in report_text
    assert "- **Current estimate range:** $257,356 to $386,034" in report_text
    assert (
        "- **Financial standpoint:** Treat the adjusted estimate as the working budget"
        in report_text
    )
    assert "**Included in this estimate**" in report_text
    assert (
        "- **Electrical panel upgrade:** $3,500 to $7,000. "
        "This is already reflected in the current estimate range."
    ) in report_text
    assert (
        "- **Solar mandate:** $7,000 to $12,000. "
        "This is already reflected for California detached ADU solar compliance."
    ) in report_text
    assert "**Not currently included**" in report_text
    assert (
        "- **Slope / retaining wall work:** $10,000 to $35,000. "
        "This may apply if the site needs significant grading or retaining wall work."
    ) in report_text


def test_build_financial_report_context_handles_missing_finance_state():
    report_context = build_financial_report_context(None)

    assert report_context.startswith("Calculator finance context:")
    assert "Estimate status: Financial estimate not started yet." in report_context
    assert (
        "Calculator-supported complications not currently included: Unknown until the calculator is started."
        in report_context
    )


def test_build_report_input_includes_finance_context_and_conversation():
    project = build_project(
        finance_state=build_snapshot(include_electric_panel=True).model_dump(
            mode="json"
        )
    )
    body = GenerateStructuredReportRequest(
        messages=[
            HistoryMessage(role="user", content="Can this ADU cash flow?"),
            HistoryMessage(
                role="assistant",
                content="Construction loans may help [11]. Green programs exist [^1].\n\n[^1]: https://example.com",
            ),
        ]
    )

    report_input = _build_report_input(project, body)

    assert "**Property Analysis Data:**" in report_input
    assert "Calculator finance context:" in report_input
    assert "Included add-ons:" in report_input
    assert "Calculator-supported complications not currently included:" in report_input
    assert "**Advisor Conversation:**" in report_input
    assert "User: Can this ADU cash flow?" in report_input
    assert "Advisor: Construction loans may help. Green programs exist." in report_input
    assert "[11]" not in report_input
    assert "[^1]" not in report_input
