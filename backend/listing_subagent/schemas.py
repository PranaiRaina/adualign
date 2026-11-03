from typing import Any
from pydantic import BaseModel, Field, field_validator
from RAG_pipeline.schemas import HistoryMessage


class EditorRequest(BaseModel):
    message: str
    history: list[HistoryMessage] | None = Field(default=None)
    listing_state: dict[str, Any] | None = None

    @field_validator("message")
    def cap_length(cls, v):
        if len(v) > 2000:
            raise ValueError("Message too long (max 2000 characters)")
        return v


class EditorUpdate(BaseModel):
    field: str
    value: Any


class EditorResponse(BaseModel):
    answer: str
    updates: list[EditorUpdate] = Field(default_factory=list)


_EDITOR_PROMPT = """\
You are an intelligent Listing Agent for an ADU marketplace.
The user is talking to you to edit the details of their ADU listing.

Analyze the User's message and determine if they want to update any fields.
Respond with a friendly conversational text acknowledging the changes or answering their question.
Do NOT just list the JSON.

Once you have formed your conversational answer, you MUST embed this exact JSON block at the END of your message:
{"updates": [{"field": "monthlyRent", "value": 2500}, {"field": "bedrooms", "value": 2}]}

If no fields need updating, return an empty list: `"updates": []`.

**Allowed fields to update:**
address, city, zipCode, description, bedrooms, bathrooms, sqft, monthlyRent, availableDate, privateEntrance, inUnitLaundry, parkingIncluded, aduType, permitStatus, constructionStatus, zoningDesignation, legalRentalStatus, kitchenType, utilitiesStrategy, leaseTerm, certificateOfOccupancy, hoaRestrictions, capRate, grossYield, paybackPeriod, constructionCost, sellerType, contactPreference, responseTime, parkingDetails, outdoorSpace, climateControl, furnished, proximityToEmployers, shortTermRentalAllowed.

If a value implies a specific enum, use these values:
- `kitchenType`: 'full', 'kitchenette', 'none'
- `inUnitLaundry`: 'in_unit', 'hookups', 'shared', 'none'
- `utilitiesStrategy`: 'separate', 'shared', 'included'
- `leaseTerm`: 'month_to_month', '6_month', '1_year', '2_year'
- `aduType`: 'detached', 'attached', 'garage_conversion', 'junior_adu', 'above_garage', 'basement'
- `furnished`: 'unfurnished', 'partially', 'fully'
- `climateControl`: 'mini_split', 'central', 'window_unit', 'none'
"""

ALLOWED_FIELDS = {
    "address",
    "city",
    "zipCode",
    "description",
    "bedrooms",
    "bathrooms",
    "sqft",
    "monthlyRent",
    "availableDate",
    "privateEntrance",
    "inUnitLaundry",
    "parkingIncluded",
    "aduType",
    "permitStatus",
    "constructionStatus",
    "zoningDesignation",
    "legalRentalStatus",
    "kitchenType",
    "utilitiesStrategy",
    "leaseTerm",
    "certificateOfOccupancy",
    "hoaRestrictions",
    "capRate",
    "grossYield",
    "paybackPeriod",
    "constructionCost",
    "sellerType",
    "contactPreference",
    "responseTime",
    "parkingDetails",
    "outdoorSpace",
    "climateControl",
    "furnished",
    "proximityToEmployers",
    "shortTermRentalAllowed",
}
