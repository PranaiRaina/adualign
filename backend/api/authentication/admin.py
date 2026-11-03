"""Admin authorization: the single choke point for every /admin/* route.

The backend connects to Postgres with a role that bypasses RLS, so this FastAPI
dependency — not RLS — is the real protection layer for admin access. Admin
identity lives in the ``admin_users`` table (orthogonal to ``users.role``).
"""

import logging

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ..database.core import get_db
from ..database.models import AdminUser, User
from .auth import get_current_user

logger = logging.getLogger(__name__)


def is_admin(db: Session, user_id: str) -> bool:
    return db.query(AdminUser).filter(AdminUser.user_id == user_id).first() is not None


def require_admin(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> User:
    """Allow only admins. Emits one structured log line per admin request, and a
    warning for every denied attempt — a free audit trail of admin activity."""
    user_id = str(current_user.id)
    if not is_admin(db, user_id):
        logger.warning(
            "Admin access denied",
            extra={
                "user_id": user_id,
                "method": request.method,
                "path": request.url.path,
            },
        )
        raise HTTPException(status_code=403, detail="Admin access required")

    logger.info(
        "Admin request",
        extra={
            "user_id": user_id,
            "method": request.method,
            "path": request.url.path,
        },
    )
    return current_user
