"""Pydantic models for the ADU financial chatbot."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class ChatMessage(BaseModel):
    """A single message in the conversation."""

    role: str = Field(..., description="'user' or 'assistant'")
    content: str


class ChatRequest(BaseModel):
    """Request payload for the /chatbot/chat endpoint."""

    messages: list[ChatMessage]
    finance_state: dict[str, Any] | None = None
    address: Optional[str] = Field(
        default=None, description="Property address from the map"
    )
    county: Optional[str] = Field(
        default=None, description="Property county from the map"
    )
    adu_sqft: Optional[float] = Field(
        default=None, description="ADU square footage pre-set from the map"
    )
    adu_width_ft: Optional[float] = Field(
        default=None, description="ADU footprint width from the map"
    )
    adu_length_ft: Optional[float] = Field(
        default=None, description="ADU footprint length from the map"
    )
    adu_type: Optional[str] = Field(
        default=None, description="ADU type selected by the user"
    )
    adu_shape: Optional[str] = Field(
        default=None, description="ADU footprint shape selected by the user"
    )
    fire_hazard_severity: Optional[str] = Field(
        default=None, description="CAL FIRE hazard severity for the property"
    )
    fire_hazard_zone_type: Optional[str] = Field(
        default=None, description="CAL FIRE zone type for the property"
    )


class EstimateRange(BaseModel):
    low: float
    high: float


class BaseEstimateInputs(BaseModel):
    county: Optional[str] = None
    adu_sqft: float
    adu_type: Optional[str] = None
    pricing_version: int


class FinanceComplicationFlags(BaseModel):
    slope: bool = False
    demolition: bool = False
    electric_panel: bool = False
    septic_tank: bool = False
    solar_mandate: bool = False
    fire_resilient_upgrades: bool = False
    hoa_restrictions: bool = False
    very_high_fire_risk: bool = False
    contingency: bool = False


class FinanceStateSnapshot(BaseModel):
    model_config = ConfigDict(extra="ignore")

    address: Optional[str] = None
    county: Optional[str] = None
    adu_sqft: Optional[float] = None
    adu_width_ft: Optional[float] = None
    adu_length_ft: Optional[float] = None
    adu_type: Optional[str] = None
    adu_shape: Optional[str] = None
    fire_hazard_severity: Optional[str] = None
    fire_hazard_zone_type: Optional[str] = None
    base_estimate_value: Optional[float] = None
    base_estimate_range: Optional[EstimateRange] = None
    base_estimate_inputs: Optional[BaseEstimateInputs] = None
    complication_flags: FinanceComplicationFlags = Field(
        default_factory=FinanceComplicationFlags
    )
    complication_adjusted_value: Optional[float] = None
    complication_adjusted_range: Optional[EstimateRange] = None


class ManualComplicationSelections(BaseModel):
    slope: bool = False
    demolition: bool = False
    electric_panel: bool = False
    septic_tank: bool = False
    hoa_restrictions: bool = False


class FinanceComplicationSummary(BaseModel):
    key: str
    label: str
    kind: str
    midpoint_cost: float
    range_low: float
    range_high: float
    is_automatic: bool = False
    trigger_reason: str | None = None
    display_range_text: str | None = None


class FinanceComplicationOption(BaseModel):
    key: str
    label: str
    display_range_text: str
    is_selected: bool
    is_automatic: bool
    trigger_reason: str | None = None


class FinancePresentationInput(BaseModel):
    model_config = ConfigDict(extra="ignore")

    address: Optional[str] = None
    county: Optional[str] = None
    adu_sqft: Optional[float] = None
    current_estimate_range: Optional[EstimateRange] = None
    base_estimate_value: Optional[float] = None
    base_estimate_range: Optional[EstimateRange] = None
    complication_adjusted_value: Optional[float] = None
    complication_adjusted_range: Optional[EstimateRange] = None
    automatic_addons: list[FinanceComplicationOption] = Field(default_factory=list)
    manual_addons: list[FinanceComplicationOption] = Field(default_factory=list)
    active_complications: list[FinanceComplicationSummary] = Field(default_factory=list)
    modeled_complications: list[dict[str, Any]] = Field(default_factory=list)
    inactive_complication_keys: list[str] = Field(default_factory=list)
    missing_inputs: list[str] = Field(default_factory=list)


class FinancialChatResult(BaseModel):
    answer: str
    sources: list[dict[str, Any]] = Field(default_factory=list)
    suggested_questions: list[str] = Field(default_factory=list)
    finance_state: FinanceStateSnapshot
    presentation: FinancePresentationInput
    report_synced: bool = False
    route: str


FinancialChatStreamEventType = Literal[
    "status",
    "text",
    "sources",
    "suggested_questions",
    "finance_state",
    "result",
]


@dataclass(frozen=True)
class FinancialChatStreamEvent:
    event: FinancialChatStreamEventType
    payload: Any


class FinanceSuggestedQuestionsOutput(BaseModel):
    questions: list[str] = Field(default_factory=list)


class ChatResponse(BaseModel):
    """Response payload from /chatbot/chat."""

    reply: str
    finance_state: dict[str, Any] | None = None


class CalculatorRequest(BaseModel):
    finance_state: dict[str, Any] | None = None
    manual_complications: ManualComplicationSelections | None = None
    persist_finance_state: bool = False
    project_id: Optional[str] = None
    address: Optional[str] = None
    county: Optional[str] = None
    adu_sqft: Optional[float] = None
    adu_width_ft: Optional[float] = None
    adu_length_ft: Optional[float] = None
    adu_type: Optional[str] = None
    adu_shape: Optional[str] = None
    fire_hazard_severity: Optional[str] = None
    fire_hazard_zone_type: Optional[str] = None


class CalculatorResponse(BaseModel):
    finance_state: dict[str, Any]
    presentation: FinancePresentationInput
    report_synced: bool = False
