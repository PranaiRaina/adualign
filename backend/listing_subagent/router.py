import logging
import json
import re
from datetime import date
from typing import Any, Literal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import TypeAdapter

from api.llm import STANDARD, acompletion_resilient
from api.rate_limiting.llm_pricing import (
    CHAT_COMPLETION_MODEL,
    LITELLM_CHAT_MODEL,
    reasoning_kwargs,
)
from api.authentication.auth import get_current_user
from api.database.models import User
from api.rate_limiting.llm_usage import record_litellm_usage, usage_accumulator_scope
from api.rate_limiting.rate_limiter import ensure_user_api_key, reserve_llm_budget

from .schemas import (
    EditorRequest,
    EditorResponse,
    EditorUpdate,
    _EDITOR_PROMPT,
    ALLOWED_FIELDS,
)
from api.chat_guardrails import (
    GuardrailPolicy,
    build_turns_from_history,
    evaluate_guardrail_for_turns,
)
from api.utils import format_tagged_block, format_tagged_turns, get_openrouter_key

logger = logging.getLogger(__name__)
BLOCKED_REPLY = (
    "I can only help with ADU-related questions and cannot process potential "
    "injection attempts."
)
EDITOR_MODEL = CHAT_COMPLETION_MODEL
LITELLM_EDITOR_MODEL = LITELLM_CHAT_MODEL

router = APIRouter(prefix="/editor", tags=["editor"])

_STRING_FIELD_LIMITS = {
    "address": 200,
    "city": 120,
    "zipCode": 20,
    "description": 5_000,
    "zoningDesignation": 80,
    "hoaRestrictions": 1_000,
    "responseTime": 120,
    "parkingDetails": 1_000,
    "proximityToEmployers": 1_000,
}
_ENUM_VALIDATORS: dict[str, TypeAdapter[Any]] = {
    "aduType": TypeAdapter(
        Literal[
            "detached",
            "attached",
            "garage_conversion",
            "junior_adu",
            "above_garage",
            "basement",
        ]
    ),
    "permitStatus": TypeAdapter(Literal["verified", "unverified", "pending"]),
    "constructionStatus": TypeAdapter(
        Literal[
            "pre_construction",
            "under_construction",
            "recently_completed",
            "established",
        ]
    ),
    "inUnitLaundry": TypeAdapter(Literal["in_unit", "hookups", "shared", "none"]),
    "kitchenType": TypeAdapter(Literal["full", "kitchenette", "none"]),
    "utilitiesStrategy": TypeAdapter(Literal["separate", "shared", "included"]),
    "leaseTerm": TypeAdapter(Literal["month_to_month", "6_month", "1_year", "2_year"]),
    "sellerType": TypeAdapter(
        Literal["homeowner", "investor", "developer", "property_manager"]
    ),
    "contactPreference": TypeAdapter(Literal["email", "phone", "in_app", "any"]),
    "outdoorSpace": TypeAdapter(
        Literal["private_yard", "shared_yard", "patio", "none"]
    ),
    "climateControl": TypeAdapter(
        Literal["mini_split", "central", "window_unit", "none"]
    ),
    "furnished": TypeAdapter(Literal["unfurnished", "partially", "fully"]),
}
_INTEGER_FIELDS = {"bedrooms", "sqft", "monthlyRent", "constructionCost"}
_FLOAT_FIELDS = {"bathrooms", "capRate", "grossYield", "paybackPeriod"}
_BOOLEAN_FIELDS = {
    "privateEntrance",
    "parkingIncluded",
    "legalRentalStatus",
    "certificateOfOccupancy",
    "shortTermRentalAllowed",
}
_INT_ADAPTER = TypeAdapter(int)
_FLOAT_ADAPTER = TypeAdapter(float)
_BOOL_ADAPTER = TypeAdapter(bool)
# Heavy base64 image fields stripped before sending listing state to the LLM
_STRIPPED_STATE_KEYS = {"images", "heroImage", "sellerAvatar"}


@router.post("/chat", response_model=EditorResponse)
async def editor_chat(
    req: EditorRequest,
    current_user: User = Depends(get_current_user),
) -> EditorResponse:
    if not req.message or not req.message.strip():
        raise HTTPException(status_code=400, detail="message is required")

    user_id = str(current_user.id)
    api_key_hash = ensure_user_api_key(user_id)

    with usage_accumulator_scope():
        async with reserve_llm_budget(
            api_key_hash=api_key_hash,
            route="guardrail",
            model=CHAT_COMPLETION_MODEL,
        ):
            guardrail_result = await evaluate_guardrail_for_turns(
                turns=build_turns_from_history(
                    message=req.message, history=req.history
                ),
                policy=GuardrailPolicy.ADU_GENERAL,
            )
    if not guardrail_result.is_allowed:
        return EditorResponse(answer=guardrail_result.denial_message or BLOCKED_REPLY)

    sanitized_message = guardrail_result.sanitized_message
    sanitized_history = (guardrail_result.sanitized_history or [])[-20:]

    api_key = get_openrouter_key()
    if not api_key:
        raise HTTPException(
            status_code=503, detail="OPENROUTER_API_KEY environment variable not set."
        )

    # Convert state dict into a pretty JSON string, stripping out massive image data
    clean_state = {
        k: v
        for k, v in (req.listing_state or {}).items()
        if k not in _STRIPPED_STATE_KEYS
    }

    state_json = json.dumps(clean_state, indent=2)
    if len(state_json) > 10000:
        logger.warning(f"listing_state is very large! ({len(state_json)} chars)")
        if "description" in clean_state and isinstance(clean_state["description"], str):
            clean_state["description"] = (
                clean_state["description"][:500] + "...[truncated]"
            )
        state_json = json.dumps(clean_state, indent=2)

    state_str = format_tagged_block("listing_data", state_json)

    instructions = _EDITOR_PROMPT

    history_text = format_tagged_turns(sanitized_history)

    full_input = (
        f"Conversation History:\n{history_text}\nCurrent State:\n{state_str}\n"
        "User's new message:\n"
        f"{format_tagged_block('user_message', sanitized_message)}"
    )

    try:
        with usage_accumulator_scope():
            async with reserve_llm_budget(
                api_key_hash=api_key_hash,
                route="editor",
                model=EDITOR_MODEL,
            ):
                response = await _run_editor_completion(
                    instructions=instructions,
                    user_input=full_input,
                    api_key=api_key,
                )
                if isinstance(response, str):
                    raw_reply = response
                else:
                    record_litellm_usage(
                        model=EDITOR_MODEL,
                        usage=getattr(response, "usage", None),
                        route="editor",
                        source="editor.chat",
                    )
                    raw_reply = _extract_message_text(response)
    except Exception as e:
        logger.error(f"Editor LLM failed: {e}")
        raise HTTPException(status_code=502, detail="Editor failed to process request.")

    # Extract JSON block
    updates = []
    clean_reply = raw_reply

    try:
        start = raw_reply.find("```json")
        if start != -1:
            end = raw_reply.find("```", start + 7)
            if end != -1:
                json_str = raw_reply[start + 7 : end].strip()
                data = json.loads(json_str)
                updates_raw = data.get("updates", [])
                for u in updates_raw:
                    field = u.get("field")
                    if field not in ALLOWED_FIELDS:
                        continue
                    validated_value = _validate_editor_field_value(
                        field,
                        u.get("value"),
                    )
                    if validated_value is None:
                        logger.info("Dropped invalid editor update for field %s", field)
                        continue
                    updates.append(EditorUpdate(field=field, value=validated_value))
                before = raw_reply[:start].strip()
                after = raw_reply[end + 3 :].strip()
                clean_reply = (before + "\n\n" + after).strip() if after else before
    except Exception as e:
        logger.warning(f"Could not parse editor JSON from model: {e}")

    clean_reply = re.sub(r"```json.*", "", clean_reply, flags=re.DOTALL).strip()

    return EditorResponse(answer=clean_reply, updates=updates)


def _validate_editor_field_value(field: str, value: Any) -> Any | None:
    try:
        if field in _STRING_FIELD_LIMITS:
            return _validate_bounded_string(
                value, max_length=_STRING_FIELD_LIMITS[field]
            )
        if field == "availableDate":
            return _validate_iso_date(value)
        if field in _INTEGER_FIELDS:
            return _INT_ADAPTER.validate_python(value)
        if field in _FLOAT_FIELDS:
            return _FLOAT_ADAPTER.validate_python(value)
        if field in _BOOLEAN_FIELDS:
            return _BOOL_ADAPTER.validate_python(value)
        if field in _ENUM_VALIDATORS:
            return _ENUM_VALIDATORS[field].validate_python(value)
    except Exception:
        return None
    return None


def _validate_bounded_string(value: Any, *, max_length: int) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    if not normalized or len(normalized) > max_length:
        return None
    return normalized


def _validate_iso_date(value: Any) -> str | None:
    normalized = _validate_bounded_string(value, max_length=10)
    if normalized is None:
        return None
    try:
        date.fromisoformat(normalized)
    except ValueError:
        return None
    return normalized


async def _run_editor_completion(
    *,
    instructions: str,
    user_input: str,
    api_key: str,
) -> Any:
    return await acompletion_resilient(
        tier=STANDARD,
        model=LITELLM_EDITOR_MODEL,
        api_key=api_key,
        messages=[
            {"role": "system", "content": instructions},
            {"role": "user", "content": user_input},
        ],
        **reasoning_kwargs(),
    )


def _extract_message_text(response: Any) -> str:
    choices = getattr(response, "choices", None) or []
    if not choices:
        return ""

    message = getattr(choices[0], "message", None)
    content = getattr(message, "content", "")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(_extract_content_part_text(part) for part in content)
    return str(content or "")


def _extract_content_part_text(part: Any) -> str:
    if isinstance(part, str):
        return part
    if isinstance(part, dict):
        text = part.get("text")
        if isinstance(text, str):
            return text
        return ""
    text = getattr(part, "text", None)
    if isinstance(text, str):
        return text
    return ""
