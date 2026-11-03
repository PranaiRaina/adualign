from __future__ import annotations
from datetime import datetime
from typing import Any, List, Literal, Optional
from pydantic import BaseModel, ConfigDict, Field

from api.property_context import AduClearance

# ── Projects ──────────────────────────────────────────────────────────


class ProjectBase(BaseModel):
    address: Optional[str] = None
    county: Optional[str] = None
    property_area_sqft: Optional[float] = None
    buildable_area_sqft: Optional[float] = None
    setback_ft: Optional[float] = None
    max_adu_sqft: Optional[float] = None
    adu_sqft: Optional[float] = None
    adu_width_ft: Optional[float] = None
    adu_length_ft: Optional[float] = None
    adu_type: Optional[str] = None
    adu_shape: Optional[str] = None
    home_sqft: Optional[float] = None
    primary_use: Optional[str] = None
    blocker_types: List[str] = Field(default_factory=list)
    fire_hazard_severity: Optional[str] = None
    fire_hazard_zone_type: Optional[str] = None
    current_yard_zone: Optional[str] = None
    adu_clearances: list[AduClearance] = Field(default_factory=list)


class ProjectCreate(ProjectBase):
    # Clients may request a project shell explicitly. Other lifecycle statuses
    # remain server-managed.
    status: Optional[Literal["project"]] = None
    finance_state: Optional[dict[str, Any]] = None
    map_snapshot: Optional[dict[str, Any]] = None


class ProjectUpdate(ProjectBase):
    """All fields optional — only provided fields are updated."""

    finance_state: Optional[dict[str, Any]] = None
    map_snapshot: Optional[dict[str, Any]] = None


class ProjectOut(ProjectBase):
    id: str
    user_id: str
    status: str = "project"
    finance_state: Optional[dict[str, Any]] = None
    map_snapshot: Optional[dict[str, Any]] = None
    created_at: datetime
    updated_at: datetime
    has_report: bool = False
    report_status: Literal["not_generated", "current", "outdated"] = "not_generated"
    has_draft: bool = False
    draft_bedrooms: Optional[int] = None
    draft_bathrooms: Optional[float] = None
    draft_monthly_rent: Optional[float] = None
    draft_hero_image: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


# ── Reports ───────────────────────────────────────────────────────────


class ReportRequirementAnswerSection(BaseModel):
    id: str
    title: str
    question: str
    answer: str
    selected_option_id: str | None = None
    status: Literal["answered", "needs_review"] = "answered"
    updated_at: datetime | None = None


class ReportVisible(BaseModel):
    model_config = ConfigDict(extra="ignore")
    executive_summary: Optional[str] = None
    property_overview: Optional[str] = None
    zoning_analysis: Optional[str] = None
    financial_snapshot: Optional[str] = None
    recommendations: Optional[str] = None
    requirements: List[ReportRequirementAnswerSection] = Field(default_factory=list)


class StructuredRequirementAnswer(BaseModel):
    question_id: str
    section: str
    normalized_value: dict[str, Any] = Field(default_factory=dict)
    confidence: Literal["high", "medium", "low"]
    missing_fields: List[str] = Field(default_factory=list)
    source: Literal["selected_option", "free_text", "mixed"]


class ReportContext(BaseModel):
    model_config = ConfigDict(extra="ignore")
    key_questions: List[str] = Field(default_factory=list)
    implicit_preferences: List[str] = Field(default_factory=list)
    notable_signals: List[str] = Field(default_factory=list)
    requirement_answers: List[StructuredRequirementAnswer] = Field(default_factory=list)
    requirement_open_items: List[str] = Field(default_factory=list)


class ReportUpdate(BaseModel):
    visible: Optional[dict[str, Any]] = None
    context: Optional[dict[str, Any]] = None


class ReportOut(BaseModel):
    id: str
    project_id: str
    version: int
    source_project_version: int = 1
    visible: ReportVisible
    context: ReportContext
    last_modified: datetime
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ── Drafts ────────────────────────────────────────────────────────────


class DraftOut(BaseModel):
    id: str
    project_id: str
    seller_id: str
    version: int
    draft_payload: dict[str, Any] = Field(default_factory=dict)
    field_meta: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class DraftUpdate(BaseModel):
    draft_payload: dict[str, Any]
    field_meta: dict[str, Any] = Field(default_factory=dict)
    expected_version: Optional[int] = None
