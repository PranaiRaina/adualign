"""Admin-only API surface.

The router-level ``dependencies=[Depends(require_admin)]`` protects every route
under ``/admin/*`` — the FastAPI equivalent of ``app.use('/api/admin', requireAdmin)``.
Future admin endpoints added here are admin-gated automatically.
"""

from __future__ import annotations

import datetime
import logging
from typing import Any, cast

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from api.authentication.admin import require_admin
from api.authentication.auth import get_current_user
from api.database.core import get_db
from api.database.models import Feedback, User
from api.database.repository import (
    SERVICE_TYPE_ADDRESS_ACCESS,
    RateLimitRepository,
    ServiceCreditRepository,
)
from api.rate_limiting.rate_limiter import (
    CONFIG_KEY_PREFIX,
    cost_usage_key,
    ensure_user_api_key,
    get_upstash_client,
)

# $5 in micros — the unit the admin +/- buttons move a user's lifetime limit by.
BUDGET_ADJUSTMENT_STEP_MICROS = 5_000_000

# Feedback that is still "new" and older than this is considered overdue triage.
FEEDBACK_OVERDUE_AFTER_HOURS = 48
FEEDBACK_STATUSES = {"new", "in_progress", "resolved"}
FEEDBACK_TOPICS = {"outreach", "bug", "feedback", "question", "other"}

router = APIRouter(
    prefix="/admin",
    tags=["admin"],
    dependencies=[Depends(require_admin)],
)

logger = logging.getLogger(__name__)


class AdminMeResponse(BaseModel):
    is_admin: bool
    user_id: str


class AdminUserUsage(BaseModel):
    id: str
    email: str
    name: str
    cost_used_micros: int
    cost_budget_micros: int
    total_tokens_used: int
    map_search_count: int
    address_credit_balance: int
    is_exhausted: bool
    created_at: str


class AdminUsageSettingsResponse(BaseModel):
    chat_budget_micros: int
    usage_reset_interval_days: int | None


class AdminUsersResponse(BaseModel):
    users: list[AdminUserUsage]
    global_settings: AdminUsageSettingsResponse


class ResetUsageResponse(BaseModel):
    user_id: str
    reset_at: str
    redis_cleared: bool


class AdjustBudgetRequest(BaseModel):
    delta_micros: int


class AdjustBudgetResponse(BaseModel):
    user_id: str
    cost_used_micros: int
    cost_budget_micros: int
    config_cache_cleared: bool


class UpdateUsageSettingsRequest(BaseModel):
    chat_budget_micros: int | None = Field(default=None, ge=0)
    usage_reset_interval_days: int | None = Field(default=None, ge=1)


class UpdateUsageSettingsResponse(BaseModel):
    global_settings: AdminUsageSettingsResponse
    affected_user_count: int
    changed_user_count: int
    config_cache_cleared_count: int


class ServiceCreditTransactionResponse(BaseModel):
    transaction_id: str
    delta: int
    reason: str
    project_id: str | None
    request_id: str | None
    actor_type: str
    actor_id: str | None
    created_at: str


class ServiceCreditHistoryResponse(BaseModel):
    user_id: str
    service_type: str
    balance: int
    transactions: list[ServiceCreditTransactionResponse]


class GrantServiceCreditsRequest(BaseModel):
    amount: int = Field(ge=1, le=1_000_000)
    idempotency_key: str = Field(min_length=8, max_length=128)


class GrantServiceCreditsResponse(BaseModel):
    user_id: str
    service_type: str
    balance: int
    transaction: ServiceCreditTransactionResponse
    applied: bool


class GrantAllServiceCreditsResponse(BaseModel):
    service_type: str
    amount: int
    users_credited: int
    users_skipped: int


class FeedbackAdminItem(BaseModel):
    id: str
    user_id: str | None
    email: str
    topic: str
    message: str
    status: str
    overdue: bool
    created_at: str


class FeedbackListResponse(BaseModel):
    feedback: list[FeedbackAdminItem]
    total: int
    overdue_count: int


class FeedbackStatusUpdate(BaseModel):
    status: str


@router.get("/me", response_model=AdminMeResponse)
def admin_me(current_user: User = Depends(get_current_user)) -> AdminMeResponse:
    """Server source of truth for admin status. 200 = admin, 403 = not (via require_admin)."""
    return AdminMeResponse(is_admin=True, user_id=str(current_user.id))


def _serialize_dt(value: datetime.datetime | None) -> str:
    if value is None:
        return ""
    if value.tzinfo is None:
        value = value.replace(tzinfo=datetime.UTC)
    return value.astimezone(datetime.UTC).isoformat()


def _serialize_admin_usage_settings(settings) -> AdminUsageSettingsResponse:
    return AdminUsageSettingsResponse(
        chat_budget_micros=int(settings.budget_micros),
        usage_reset_interval_days=settings.usage_reset_interval_days,
    )


def _clear_config_cache_key(api_key_hash: str) -> bool:
    client = get_upstash_client()
    if client is None:
        return False
    client.delete(f"{CONFIG_KEY_PREFIX}{api_key_hash}")
    return True


def _clear_config_cache_keys(api_key_hashes: list[str]) -> int:
    cleared = 0
    for api_key_hash in api_key_hashes:
        try:
            if _clear_config_cache_key(api_key_hash):
                cleared += 1
        except Exception as exc:  # noqa: BLE001 - cache is best-effort; DB is source of truth
            logger.error(
                "Admin usage settings persisted but failed to clear config cache "
                "for api_key_hash_prefix=%s: %s",
                api_key_hash[:8],
                exc,
            )
    return cleared


@router.get("/users", response_model=AdminUsersResponse)
def list_users(db: Session = Depends(get_db)) -> AdminUsersResponse:
    """Every user with their lifetime AI usage against their budget."""
    rows = RateLimitRepository.list_user_usage_overview(db)
    global_settings = RateLimitRepository.get_admin_usage_settings(db)
    credit_balances = ServiceCreditRepository.list_balances_by_user_id(
        db, service_type=SERVICE_TYPE_ADDRESS_ACCESS
    )
    credit_search_counts = ServiceCreditRepository.list_map_search_counts_by_user_id(db)

    users: list[AdminUserUsage] = []
    for row in rows:
        budget = int(row.get("budget_micros") or 0)
        used = int(row.get("cost_used_micros") or 0)
        user_id = str(row["id"])
        users.append(
            AdminUserUsage(
                id=user_id,
                email=str(row.get("email") or ""),
                name=str(row.get("name") or ""),
                cost_used_micros=used,
                cost_budget_micros=budget,
                total_tokens_used=int(row.get("total_tokens_used") or 0),
                map_search_count=(
                    int(row.get("map_search_count") or 0)
                    + credit_search_counts.get(user_id, 0)
                ),
                address_credit_balance=credit_balances.get(user_id, 0),
                is_exhausted=budget > 0 and used >= budget,
                created_at=_serialize_dt(row.get("created_at")),
            )
        )

    return AdminUsersResponse(
        users=users,
        global_settings=_serialize_admin_usage_settings(global_settings),
    )


@router.patch("/usage-settings", response_model=UpdateUsageSettingsResponse)
def update_usage_settings(
    body: UpdateUsageSettingsRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UpdateUsageSettingsResponse:
    """Persist global usage defaults and apply them to every active user row."""
    update_budget = "chat_budget_micros" in body.model_fields_set
    update_usage_reset_interval = "usage_reset_interval_days" in body.model_fields_set
    if not update_budget and not update_usage_reset_interval:
        raise HTTPException(
            status_code=400,
            detail="At least one usage setting must be provided.",
        )
    if update_budget and body.chat_budget_micros is None:
        raise HTTPException(
            status_code=400,
            detail="chat_budget_micros cannot be null.",
        )

    previous_settings = RateLimitRepository.get_admin_usage_settings(db)
    mutation = RateLimitRepository.apply_global_usage_settings(
        db,
        update_budget=update_budget,
        budget_micros=body.chat_budget_micros,
        update_usage_reset_interval=update_usage_reset_interval,
        usage_reset_interval_days=body.usage_reset_interval_days,
        actor_id=str(current_user.id),
    )
    cleared_count = _clear_config_cache_keys(mutation.invalidated_api_key_hashes)

    logger.info(
        "Admin updated global usage settings",
        extra={
            "actor_user_id": str(current_user.id),
            "previous_budget_micros": previous_settings.budget_micros,
            "new_budget_micros": mutation.settings.budget_micros,
            "previous_usage_reset_interval_days": previous_settings.usage_reset_interval_days,
            "new_usage_reset_interval_days": mutation.settings.usage_reset_interval_days,
            "affected_user_count": mutation.affected_user_count,
            "changed_user_count": mutation.changed_user_count,
            "config_cache_cleared_count": cleared_count,
        },
    )

    return UpdateUsageSettingsResponse(
        global_settings=_serialize_admin_usage_settings(mutation.settings),
        affected_user_count=mutation.affected_user_count,
        changed_user_count=mutation.changed_user_count,
        config_cache_cleared_count=cleared_count,
    )


def _serialize_service_transaction(transaction) -> ServiceCreditTransactionResponse:
    return ServiceCreditTransactionResponse(
        transaction_id=str(transaction.transaction_id),
        delta=int(transaction.delta),
        reason=str(transaction.reason),
        project_id=transaction.project_id,
        request_id=transaction.request_id,
        actor_type=str(transaction.actor_type),
        actor_id=transaction.actor_id,
        created_at=_serialize_dt(transaction.created_at),
    )


@router.get(
    "/users/{user_id}/service-credits",
    response_model=ServiceCreditHistoryResponse,
)
def get_user_service_credits(
    user_id: str,
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> ServiceCreditHistoryResponse:
    target = db.query(User).filter(User.id == user_id).first()
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")

    balance = ServiceCreditRepository.get_balance(
        db, user_id=user_id, service_type=SERVICE_TYPE_ADDRESS_ACCESS
    )
    transactions = ServiceCreditRepository.list_recent_transactions(
        db,
        user_id=user_id,
        service_type=SERVICE_TYPE_ADDRESS_ACCESS,
        limit=limit,
    )
    return ServiceCreditHistoryResponse(
        user_id=user_id,
        service_type=SERVICE_TYPE_ADDRESS_ACCESS,
        balance=int(balance.balance) if balance else 0,
        transactions=[_serialize_service_transaction(item) for item in transactions],
    )


@router.post(
    "/users/{user_id}/service-credits/grant",
    response_model=GrantServiceCreditsResponse,
)
def grant_user_service_credits(
    user_id: str,
    body: GrantServiceCreditsRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> GrantServiceCreditsResponse:
    target = db.query(User).filter(User.id == user_id).first()
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")

    result = ServiceCreditRepository.grant_credits(
        db,
        user_id=user_id,
        service_type=SERVICE_TYPE_ADDRESS_ACCESS,
        amount=body.amount,
        reason="admin_adjustment",
        actor_type="admin",
        actor_id=str(current_user.id),
        idempotency_key=f"admin_grant:{user_id}:{body.idempotency_key}",
    )
    logger.info(
        "Admin granted address credits",
        extra={
            "actor_user_id": str(current_user.id),
            "target_user_id": user_id,
            "amount": body.amount,
            "transaction_id": str(result.transaction.transaction_id),
            "applied": result.applied,
        },
    )
    return GrantServiceCreditsResponse(
        user_id=user_id,
        service_type=SERVICE_TYPE_ADDRESS_ACCESS,
        balance=int(result.balance.balance),
        transaction=_serialize_service_transaction(result.transaction),
        applied=result.applied,
    )


@router.post(
    "/service-credits/grant-all",
    response_model=GrantAllServiceCreditsResponse,
)
def grant_all_service_credits(
    body: GrantServiceCreditsRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> GrantAllServiceCreditsResponse:
    """Grant address credits to every account.

    grant_credits commits per user, so a mid-loop failure leaves earlier
    grants applied; retrying with the same idempotency_key fills only the gaps.
    """
    user_ids = [str(row[0]) for row in db.query(User.id).all()]
    credited = 0
    skipped = 0
    for user_id in user_ids:
        result = ServiceCreditRepository.grant_credits(
            db,
            user_id=user_id,
            service_type=SERVICE_TYPE_ADDRESS_ACCESS,
            amount=body.amount,
            reason="admin_adjustment",
            actor_type="admin",
            actor_id=str(current_user.id),
            idempotency_key=f"admin_grant_all:{body.idempotency_key}:{user_id}",
        )
        if result.applied:
            credited += 1
        else:
            skipped += 1
    logger.info(
        "Admin granted address credits to all users",
        extra={
            "actor_user_id": str(current_user.id),
            "amount": body.amount,
            "users_credited": credited,
            "users_skipped": skipped,
        },
    )
    return GrantAllServiceCreditsResponse(
        service_type=SERVICE_TYPE_ADDRESS_ACCESS,
        amount=body.amount,
        users_credited=credited,
        users_skipped=skipped,
    )


@router.post("/users/{user_id}/reset-usage", response_model=ResetUsageResponse)
def reset_user_usage(
    user_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ResetUsageResponse:
    """Reset a user's chat usage counter and clear the live Redis reservation."""
    target = db.query(User).filter(User.id == user_id).first()
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")

    api_key_hash = ensure_user_api_key(user_id)
    reset_at = datetime.datetime.now(datetime.UTC)
    api_key = RateLimitRepository.set_usage_reset_marker(
        db,
        user_id=user_id,
        reset_at=reset_at,
        actor_type="admin",
        actor_id=str(current_user.id),
    )
    if api_key is None:
        raise HTTPException(
            status_code=503,
            detail="Could not resolve an active API key for this user.",
        )

    redis_cleared = False
    client = get_upstash_client()
    if client is not None:
        try:
            client.delete(cost_usage_key(api_key_hash))
            redis_cleared = True
        except Exception as exc:  # noqa: BLE001 - Redis is best-effort here
            logger.error(
                "Admin usage reset cleared DB floor but failed to clear Redis "
                "counter for user_id=%s: %s",
                user_id,
                exc,
            )

    logger.info(
        "Admin reset user usage",
        extra={
            "actor_user_id": str(current_user.id),
            "target_user_id": user_id,
            "reset_at": reset_at.isoformat(),
            "redis_cleared": redis_cleared,
        },
    )

    return ResetUsageResponse(
        user_id=user_id,
        reset_at=reset_at.isoformat(),
        redis_cleared=redis_cleared,
    )


@router.post("/users/{user_id}/adjust-budget", response_model=AdjustBudgetResponse)
@router.post("/users/{user_id}/adjust-usage", response_model=AdjustBudgetResponse)
def adjust_user_budget(
    user_id: str,
    body: AdjustBudgetRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AdjustBudgetResponse:
    """Move a user's lifetime budget up/down by ``delta_micros``.

    The +/-$5 admin buttons change the denominator in the usage meter. A -$5
    action on a $10 budget makes the same logged usage count against a $5 limit,
    so the visible percentage doubles.
    """
    target_user = db.query(User).filter(User.id == user_id).first()
    if target_user is None:
        raise HTTPException(status_code=404, detail="User not found")

    api_key_hash = ensure_user_api_key(user_id)
    api_key = RateLimitRepository.get_api_key_by_user_id(db, user_id)
    if api_key is None:
        raise HTTPException(
            status_code=503,
            detail="Could not resolve an active API key for this user.",
        )
    if body.delta_micros not in {
        -BUDGET_ADJUSTMENT_STEP_MICROS,
        BUDGET_ADJUSTMENT_STEP_MICROS,
    }:
        raise HTTPException(
            status_code=400,
            detail="Budget adjustments must be exactly +/- $5.",
        )

    budget_micros = int(getattr(api_key, "budget_micros", 0) or 0)
    new_budget_micros = max(0, budget_micros + int(body.delta_micros))

    logs_cost_micros = RateLimitRepository.get_period_usage_totals_for_user(
        db,
        user_id=user_id,
    )["cost_used_micros"]

    RateLimitRepository.set_user_budget_micros(
        db,
        user_id=user_id,
        budget_micros=new_budget_micros,
        actor_type="admin",
        actor_id=str(current_user.id),
    )

    config_cache_cleared = False
    try:
        config_cache_cleared = _clear_config_cache_key(api_key_hash)
    except Exception as exc:  # noqa: BLE001 - cache is best-effort; DB is source of truth
        logger.error(
            "Admin budget adjustment persisted to DB but failed to clear config "
            "cache for user_id=%s: %s",
            user_id,
            exc,
        )

    logger.info(
        "Admin adjusted user budget",
        extra={
            "actor_user_id": str(current_user.id),
            "target_user_id": user_id,
            "delta_micros": int(body.delta_micros),
            "logs_cost_micros": logs_cost_micros,
            "previous_budget_micros": budget_micros,
            "new_budget_micros": new_budget_micros,
            "config_cache_cleared": config_cache_cleared,
        },
    )

    return AdjustBudgetResponse(
        user_id=user_id,
        cost_used_micros=logs_cost_micros,
        cost_budget_micros=new_budget_micros,
        config_cache_cleared=config_cache_cleared,
    )


def _is_feedback_overdue(status: str, created_at: datetime.datetime | None) -> bool:
    if status != "new" or created_at is None:
        return False
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=datetime.UTC)
    age = datetime.datetime.now(datetime.UTC) - created_at
    return age >= datetime.timedelta(hours=FEEDBACK_OVERDUE_AFTER_HOURS)


def _serialize_feedback(row: Feedback) -> FeedbackAdminItem:
    feedback = cast(Any, row)
    created_at = cast(datetime.datetime | None, feedback.created_at)
    status = str(feedback.status or "new")
    return FeedbackAdminItem(
        id=str(feedback.id),
        user_id=str(feedback.user_id) if feedback.user_id else None,
        email=str(feedback.email or ""),
        topic=str(feedback.topic or ""),
        message=str(feedback.message or ""),
        status=status,
        overdue=_is_feedback_overdue(status, created_at),
        created_at=_serialize_dt(created_at),
    )


@router.get("/feedback", response_model=FeedbackListResponse)
def list_feedback(
    status: str | None = Query(default=None),
    topic: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> FeedbackListResponse:
    """All feedback submissions, newest first, with optional status/topic filters."""
    if status is not None and status not in FEEDBACK_STATUSES:
        raise HTTPException(status_code=422, detail="Unknown status")
    if topic is not None and topic not in FEEDBACK_TOPICS:
        raise HTTPException(status_code=422, detail="Unknown topic")

    query = db.query(Feedback)
    if status is not None:
        query = query.filter(Feedback.status == status)
    if topic is not None:
        query = query.filter(Feedback.topic == topic)

    total = query.count()
    rows = query.order_by(Feedback.created_at.desc()).offset(offset).limit(limit).all()

    items = [_serialize_feedback(row) for row in rows]
    overdue_count = (
        db.query(Feedback)
        .filter(
            Feedback.status == "new",
            Feedback.created_at
            <= datetime.datetime.now(datetime.UTC)
            - datetime.timedelta(hours=FEEDBACK_OVERDUE_AFTER_HOURS),
        )
        .count()
    )

    return FeedbackListResponse(
        feedback=items,
        total=total,
        overdue_count=overdue_count,
    )


@router.patch("/feedback/{feedback_id}", response_model=FeedbackAdminItem)
def update_feedback_status(
    feedback_id: str,
    body: FeedbackStatusUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FeedbackAdminItem:
    """Update a feedback item's triage status."""
    if body.status not in FEEDBACK_STATUSES:
        raise HTTPException(status_code=422, detail="Unknown status")

    row = cast(Any, db.query(Feedback).filter(Feedback.id == feedback_id).first())
    if row is None:
        raise HTTPException(status_code=404, detail="Feedback not found")

    row.status = body.status
    db.commit()
    db.refresh(row)

    logger.info(
        "Admin updated feedback status",
        extra={
            "actor_user_id": str(current_user.id),
            "feedback_id": feedback_id,
            "new_status": body.status,
        },
    )

    return _serialize_feedback(row)
