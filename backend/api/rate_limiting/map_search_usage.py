"""Address-credit metering for ReportAll map property searches."""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass
from typing import cast

from fastapi import HTTPException

from api.database.core import SessionLocal
from api.database.repository import (
    SERVICE_TYPE_ADDRESS_ACCESS,
    ReportRepository,
    ServiceCreditRepository,
)
from api.schemas import MapSearchUsage

logger = logging.getLogger(__name__)

MAP_SEARCH_CREDIT_COST = 1
MAP_SEARCH_IDEMPOTENCY_VERSION = "v1"


def _log_map_search_usage(
    usage: MapSearchUsage,
    *,
    request_id: str | None = None,
    reason: str | None = None,
) -> None:
    logger.info(
        "Map-search usage status=%s charged=%s credits=%d remaining=%s request_id=%s reason=%s",
        usage.status,
        usage.charged,
        usage.credits_charged,
        usage.remaining_credits,
        request_id or "-",
        reason or "-",
        extra={
            "map_search_usage_status": usage.status,
            "charged": usage.charged,
            "credits_charged": usage.credits_charged,
            "remaining_credits": usage.remaining_credits,
            "request_id": request_id,
            "reason": reason,
        },
    )


@dataclass
class MapSearchCharge:
    """A debited map search that can be finalized or refunded."""

    usage: MapSearchUsage
    user_id: str
    request_id: str | None = None
    debit_transaction_id: str | None = None
    debit_applied: bool = False
    committed: bool = False

    def commit(self) -> MapSearchUsage:
        self.committed = True
        _log_map_search_usage(
            self.usage,
            request_id=self.request_id,
            reason="committed",
        )
        return self.usage

    def cancel_failed(self) -> MapSearchUsage:
        remaining_credits = self.usage.remaining_credits
        if self.debit_applied and not self.committed and self.request_id:
            remaining_credits = self._refund_debit()

        self.usage = MapSearchUsage(
            charged=False,
            credits_charged=0,
            remaining_credits=remaining_credits,
            status="failed",
        )
        _log_map_search_usage(
            self.usage,
            request_id=self.request_id,
            reason="cancelled",
        )
        return self.usage

    def _refund_debit(self) -> int:
        assert self.request_id is not None
        with SessionLocal() as db:
            result = ServiceCreditRepository.grant_credits(
                db,
                user_id=self.user_id,
                service_type=SERVICE_TYPE_ADDRESS_ACCESS,
                amount=MAP_SEARCH_CREDIT_COST,
                reason="refund",
                actor_type="system",
                idempotency_key=f"{self.request_id}:refund:{MAP_SEARCH_IDEMPOTENCY_VERSION}",
                request_id=self.request_id,
                metadata={"debit_transaction_id": self.debit_transaction_id},
            )
            return int(result.balance.balance)


def not_chargeable_map_search_usage() -> MapSearchUsage:
    return MapSearchUsage(status="not_chargeable")


def reserve_map_search_charge(
    *,
    user_id: str,
    project_id: str | None,
    map_search_id: str | None,
) -> MapSearchCharge:
    if _is_existing_project_exempt(user_id=user_id, project_id=project_id):
        usage = MapSearchUsage(status="exempt_existing_project")
        _log_map_search_usage(usage, reason="existing_project")
        return MapSearchCharge(usage=usage, user_id=user_id)

    if not map_search_id:
        usage = not_chargeable_map_search_usage()
        _log_map_search_usage(usage, reason="missing_map_search_id")
        return MapSearchCharge(usage=usage, user_id=user_id)

    request_id = _map_search_request_id(user_id, map_search_id)
    with SessionLocal() as db:
        result = ServiceCreditRepository.debit_credits(
            db,
            user_id=user_id,
            service_type=SERVICE_TYPE_ADDRESS_ACCESS,
            amount=MAP_SEARCH_CREDIT_COST,
            reason="map_search_charge",
            actor_type="user",
            actor_id=user_id,
            idempotency_key=f"{request_id}:debit:{MAP_SEARCH_IDEMPOTENCY_VERSION}",
            project_id=project_id,
            request_id=request_id,
            metadata={"map_search_id": map_search_id},
        )

    if result is None:
        raise HTTPException(
            status_code=402,
            detail={
                "message": "No address credits remaining.",
                "service_type": SERVICE_TYPE_ADDRESS_ACCESS,
                "balance": 0,
            },
        )

    remaining_credits = int(result.balance.balance)
    if not result.applied:
        usage = MapSearchUsage(
            remaining_credits=remaining_credits,
            status="deduped",
        )
        _log_map_search_usage(usage, request_id=request_id, reason="duplicate_request")
        return MapSearchCharge(
            usage=usage,
            user_id=user_id,
            request_id=request_id,
        )

    usage = MapSearchUsage(
        charged=True,
        credits_charged=MAP_SEARCH_CREDIT_COST,
        remaining_credits=remaining_credits,
        status="charged",
    )
    return MapSearchCharge(
        usage=usage,
        user_id=user_id,
        request_id=request_id,
        debit_transaction_id=str(result.transaction.transaction_id),
        debit_applied=True,
    )


def _is_existing_project_exempt(*, user_id: str, project_id: str | None) -> bool:
    if not project_id:
        return False

    with SessionLocal() as db:
        project = ReportRepository.get_project(db, project_id, user_id=user_id)
        if project is None:
            return False
        return cast(str, getattr(project, "status", "new")) != "new"


def _map_search_request_id(user_id: str, map_search_id: str) -> str:
    digest = hashlib.sha256(f"{user_id}:{map_search_id}".encode("utf-8")).hexdigest()
    return f"map_search:{digest}"
