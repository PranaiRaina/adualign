"""Shared AI service usage endpoint consumed by the frontend usage meter."""

from __future__ import annotations

import logging
from typing import Annotated, cast

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.authentication.admin import is_admin
from api.authentication.auth import get_current_user
from api.database.core import get_db
from api.database.models import User
from api.database.repository import (
    SERVICE_TYPE_ADDRESS_ACCESS,
    RateLimitRepository,
    ServiceCreditRepository,
)
from api.rate_limiting.rate_limiter import (
    cost_usage_key,
    ensure_user_api_key,
    get_upstash_client,
)

router = APIRouter(prefix="/usage", tags=["usage"])
logger = logging.getLogger(__name__)


class UsageBudgetResponse(BaseModel):
    cost_used_micros: int
    cost_budget_micros: int
    cost_remaining_micros: int
    address_credit_balance: int
    percent_used: float
    percent_remaining: float
    budget_currency: str
    resets_at: str
    total_tokens_used: int
    prompt_tokens_used: int
    completion_tokens_used: int
    tokens_used: int
    map_search_count: int


class BudgetStatusResponse(BaseModel):
    chat_usage_id: str
    budget_currency: str
    budget_micros: int
    db_cost_used_micros: int
    redis_cost_used_micros: int
    effective_cost_used_micros: int
    remaining_budget_micros: int
    percent_used: float
    cost_usage_key: str
    redis_available: bool
    redis_counter_cleared: bool
    reset_applied: bool


def _require_admin(db: Session, current_user: User) -> None:
    if not is_admin(db, str(current_user.id)):
        raise HTTPException(status_code=403, detail="Admin access required")


def _require_budget_micros(api_key_row) -> int:
    budget_micros = getattr(api_key_row, "budget_micros", None)
    if budget_micros is None:
        raise HTTPException(
            status_code=503,
            detail="Rate limiter configuration is invalid. Contact support.",
        )
    return int(budget_micros)


def _percent_used(used: int, budget: int) -> float:
    if budget <= 0:
        return 0.0
    return round((used / budget) * 100, 4)


@router.get("/me", response_model=UsageBudgetResponse)
def get_my_usage(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    current_user_id = cast(str, current_user.id)
    api_key_hash = ensure_user_api_key(current_user_id)
    api_key_row = RateLimitRepository.get_api_key_by_user_id(db, current_user_id)
    if api_key_row is None:
        logger.info(
            "Usage budget requested without active API key",
            extra={"user_id": current_user_id},
        )
        address_credit_balance = 0
        address_balance = ServiceCreditRepository.get_balance(
            db,
            user_id=current_user_id,
            service_type=SERVICE_TYPE_ADDRESS_ACCESS,
        )
        if address_balance is not None:
            address_credit_balance = int(address_balance.balance or 0)
        return UsageBudgetResponse(
            cost_used_micros=0,
            cost_budget_micros=0,
            cost_remaining_micros=0,
            address_credit_balance=address_credit_balance,
            percent_used=0.0,
            percent_remaining=0.0,
            budget_currency="USD",
            resets_at="",
            total_tokens_used=0,
            prompt_tokens_used=0,
            completion_tokens_used=0,
            tokens_used=0,
            map_search_count=0,
        )

    period_totals = RateLimitRepository.get_period_usage_totals_for_user(
        db,
        user_id=current_user_id,
        period=None,
    )
    cost_used_micros = period_totals["cost_used_micros"]
    client = get_upstash_client()
    if client is not None:
        try:
            raw = client.get(cost_usage_key(api_key_hash))
            if raw is not None:
                cost_used_micros = max(cost_used_micros, int(raw))
        except Exception:
            pass

    cost_budget_micros = _require_budget_micros(api_key_row)
    cost_remaining_micros = max(cost_budget_micros - cost_used_micros, 0)
    address_credit_balance = 0
    address_balance = ServiceCreditRepository.get_balance(
        db,
        user_id=current_user_id,
        service_type=SERVICE_TYPE_ADDRESS_ACCESS,
    )
    if address_balance is not None:
        address_credit_balance = int(address_balance.balance or 0)
    percent_used = _percent_used(cost_used_micros, cost_budget_micros)
    token_used = period_totals["total_tokens_used"]

    logger.info(
        "Usage budget returned: used=$%.6f / budget=$%.6f "
        "(remaining=$%.6f, %.1f%% used, tokens=%d)",
        cost_used_micros / 1_000_000,
        cost_budget_micros / 1_000_000,
        cost_remaining_micros / 1_000_000,
        percent_used,
        token_used,
        extra={
            "user_id": current_user_id,
            "cost_used_micros": cost_used_micros,
            "cost_budget_micros": cost_budget_micros,
            "cost_remaining_micros": cost_remaining_micros,
            "address_credit_balance": address_credit_balance,
            "token_used": token_used,
            "redis_available": client is not None,
        },
    )

    return UsageBudgetResponse(
        cost_used_micros=cost_used_micros,
        cost_budget_micros=cost_budget_micros,
        cost_remaining_micros=cost_remaining_micros,
        address_credit_balance=address_credit_balance,
        percent_used=percent_used,
        percent_remaining=round(max(100.0 - percent_used, 0.0), 4),
        budget_currency=cast(str, getattr(api_key_row, "budget_currency", "USD")),
        resets_at="",
        total_tokens_used=period_totals["total_tokens_used"],
        prompt_tokens_used=period_totals["prompt_tokens_used"],
        completion_tokens_used=period_totals["completion_tokens_used"],
        tokens_used=token_used,
        map_search_count=period_totals["map_search_count"],
    )


@router.get("/budget-status", response_model=BudgetStatusResponse)
def get_budget_status(
    reset: Annotated[bool, Query(deprecated=True)] = False,
    clear_redis_counter: Annotated[bool, Query()] = False,
    user_id: Annotated[str | None, Query()] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_admin(db, current_user)

    target_user_id = user_id or cast(str, current_user.id)
    api_key_hash = ensure_user_api_key(target_user_id)
    api_key_row = RateLimitRepository.get_api_key_by_user_id(db, target_user_id)
    if api_key_row is None:
        raise HTTPException(
            status_code=404, detail="Active service API key not configured"
        )

    redis_key = cost_usage_key(api_key_hash)
    period_totals = RateLimitRepository.get_period_usage_totals_for_user(
        db,
        user_id=target_user_id,
        period=None,
    )
    db_cost_used_micros = period_totals["cost_used_micros"]

    client = get_upstash_client()
    redis_available = client is not None
    redis_cost_used_micros = 0
    should_clear_redis_counter = reset or clear_redis_counter
    redis_counter_cleared = False

    if client is not None:
        try:
            if should_clear_redis_counter:
                client.delete(redis_key)
                redis_counter_cleared = True
            raw = client.get(redis_key)
            if raw is not None:
                redis_cost_used_micros = int(raw)
        except Exception as exc:
            raise HTTPException(
                status_code=503,
                detail=f"Redis budget inspection failed: {exc}",
            ) from exc

    budget_micros = _require_budget_micros(api_key_row)
    effective_cost_used_micros = max(db_cost_used_micros, redis_cost_used_micros)
    remaining_budget_micros = max(budget_micros - effective_cost_used_micros, 0)
    percent_used = (
        round((effective_cost_used_micros / budget_micros) * 100, 4)
        if budget_micros > 0
        else 0.0
    )

    logger.info(
        "Usage budget status returned",
        extra={
            "user_id": target_user_id,
            "chat_usage_id": cast(str, api_key_row.id),
            "budget_micros": budget_micros,
            "db_cost_used_micros": db_cost_used_micros,
            "redis_cost_used_micros": redis_cost_used_micros,
            "effective_cost_used_micros": effective_cost_used_micros,
            "remaining_budget_micros": remaining_budget_micros,
            "redis_available": redis_available,
            "redis_counter_cleared": redis_counter_cleared,
        },
    )

    return BudgetStatusResponse(
        chat_usage_id=cast(str, api_key_row.id),
        budget_currency=cast(str, getattr(api_key_row, "budget_currency", "USD")),
        budget_micros=budget_micros,
        db_cost_used_micros=db_cost_used_micros,
        redis_cost_used_micros=redis_cost_used_micros,
        effective_cost_used_micros=effective_cost_used_micros,
        remaining_budget_micros=remaining_budget_micros,
        percent_used=percent_used,
        cost_usage_key=redis_key,
        redis_available=redis_available,
        redis_counter_cleared=redis_counter_cleared,
        reset_applied=redis_counter_cleared,
    )
