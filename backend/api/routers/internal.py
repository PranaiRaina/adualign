"""Internal endpoints invoked by external schedulers (Supabase pg_cron).

These routes are not for end users. They are authenticated with a shared
secret (``CRON_SECRET``) passed in the ``X-Cron-Secret`` header.
"""

from __future__ import annotations

import logging
import os
import secrets

from fastapi import APIRouter, Header, HTTPException
from starlette.concurrency import run_in_threadpool

from api.rate_limiting.usage_resets import UsageResetSweepResult, reset_due_chat_usage

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/internal", tags=["internal"])


def _verify_cron_secret(provided: str | None) -> None:
    expected = os.getenv("CRON_SECRET")
    if not expected:
        raise HTTPException(status_code=503, detail="CRON_SECRET is not configured.")
    if provided is None or not secrets.compare_digest(provided, expected):
        raise HTTPException(status_code=401, detail="Invalid cron secret.")


@router.post("/usage-resets/run", response_model=UsageResetSweepResult)
async def run_usage_reset_sweep(
    x_cron_secret: str | None = Header(default=None),
) -> UsageResetSweepResult:
    """Reset every chat-usage budget whose reset interval has elapsed.

    Called by Supabase pg_cron every 15 minutes. The sweep is idempotent, so
    overlapping or repeated invocations are safe.
    """
    _verify_cron_secret(x_cron_secret)
    result = await run_in_threadpool(reset_due_chat_usage)
    logger.info(
        "Usage reset sweep completed",
        extra={
            "checked": result.checked,
            "reset": result.reset,
            "redis_cleared": result.redis_cleared,
            "redis_errors": result.redis_errors,
        },
    )
    return result
