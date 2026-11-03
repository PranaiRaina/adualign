"""
FastAPI router for the ADU Financial Chatbot.

Endpoints:
  POST /chatbot/chat       — multi-turn conversation
  POST /chatbot/calculator — finance-state calculator
"""

import logging
from typing import cast

from fastapi import APIRouter, Depends, HTTPException

from api.authentication.auth import get_current_user
from api.chat_guardrails import GuardrailPolicy, evaluate_guardrail_for_turns
from api.database.models import User
from api.errors import GENERIC_ERROR_MESSAGE
from api.rate_limiting.llm_pricing import CHAT_COMPLETION_MODEL
from api.rate_limiting.llm_usage import usage_accumulator_scope
from api.rate_limiting.rate_limiter import reserve_llm_budget, ensure_user_api_key
from .schemas import (
    CalculatorRequest,
    CalculatorResponse,
    ChatMessage,
    ChatRequest,
    ChatResponse,
)
from .service import calculate_finance_snapshot, run_financial_chat

router = APIRouter(prefix="/chatbot", tags=["chatbot"])
logger = logging.getLogger(__name__)


def require_authenticated_user_id(current_user: User | None) -> str:
    if current_user is None:
        raise HTTPException(
            status_code=401,
            detail="Authentication is required for finance chat.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return cast(str, current_user.id)


@router.post("/chat", response_model=ChatResponse)
async def chat_endpoint(
    req: ChatRequest,
    current_user: User | None = Depends(get_current_user),
) -> ChatResponse:
    """
    Multi-turn ADU financial advisor chat.

    Pass the full conversation history on every request.
    Include `finance_state` from the previous reply to continue
    manual complication tracking across turns.
    """
    api_key_hash = ensure_user_api_key(require_authenticated_user_id(current_user))

    try:
        with usage_accumulator_scope():
            async with reserve_llm_budget(
                api_key_hash=api_key_hash,
                route="guardrail",
                fallback_cost_micros=200,
                model=CHAT_COMPLETION_MODEL,
            ):
                guardrail_result = await evaluate_guardrail_for_turns(
                    turns=req.messages,
                    policy=GuardrailPolicy.FINANCE_ONLY,
                )

            if not guardrail_result.is_allowed:
                return ChatResponse(
                    reply=guardrail_result.denial_message or "",
                    finance_state=req.finance_state,
                )

            sanitized_messages = [
                ChatMessage(role=turn.role, content=turn.content)
                for turn in guardrail_result.sanitized_turns
            ]

            async with reserve_llm_budget(
                api_key_hash=api_key_hash,
                route="finance",
                fallback_cost_micros=15_000,
                model=CHAT_COMPLETION_MODEL,
            ):
                result = await run_financial_chat(
                    messages=sanitized_messages,
                    stored_finance_state=req.finance_state,
                    address=req.address,
                    county=req.county,
                    adu_sqft=req.adu_sqft,
                    adu_width_ft=req.adu_width_ft,
                    adu_length_ft=req.adu_length_ft,
                    adu_type=req.adu_type,
                    adu_shape=req.adu_shape,
                    fire_hazard_severity=req.fire_hazard_severity,
                    fire_hazard_zone_type=req.fire_hazard_zone_type,
                )
    except HTTPException:
        raise
    except RuntimeError:
        logger.exception("Finance chat request failed")
        raise HTTPException(
            status_code=503,
            detail=GENERIC_ERROR_MESSAGE,
        )

    return ChatResponse(
        reply=result.answer,
        finance_state=result.finance_state.model_dump(mode="json"),
    )


@router.post("/calculator", response_model=CalculatorResponse)
def calculator_endpoint(
    req: CalculatorRequest,
    current_user: User | None = Depends(get_current_user),
) -> CalculatorResponse:
    require_authenticated_user_id(current_user)

    try:
        finance_state, presentation = calculate_finance_snapshot(
            stored_finance_state=req.finance_state,
            manual_complications=req.manual_complications,
            address=req.address,
            county=req.county,
            adu_sqft=req.adu_sqft,
            adu_width_ft=req.adu_width_ft,
            adu_length_ft=req.adu_length_ft,
            adu_type=req.adu_type,
            adu_shape=req.adu_shape,
            fire_hazard_severity=req.fire_hazard_severity,
            fire_hazard_zone_type=req.fire_hazard_zone_type,
        )
    except RuntimeError:
        logger.exception("Finance calculator request failed")
        raise HTTPException(
            status_code=503,
            detail=GENERIC_ERROR_MESSAGE,
        )

    return CalculatorResponse(
        finance_state=finance_state.model_dump(mode="json"),
        presentation=presentation,
        report_synced=False,
    )
