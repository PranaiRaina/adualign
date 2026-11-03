"""Public contact/feedback endpoint backing the frontend /contact page."""

from __future__ import annotations

import logging
import re
import time
from collections import defaultdict, deque

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from api.authentication.auth import get_user_from_authorization_header
from api.database.core import get_db
from api.database.models import Feedback

router = APIRouter(prefix="/feedback", tags=["feedback"])
logger = logging.getLogger(__name__)

# "outreach" backs the public /contact "Get in touch" page; the rest come from
# the in-app feedback tab/panel.
TOPICS = {"outreach", "bug", "feedback", "question", "other"}
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# ponytail: in-process per-IP throttle (5/hour), resets on restart and is
# per-replica; move to the existing Upstash client if replicas/volume grow.
RATE_LIMIT = 5
RATE_WINDOW_SECONDS = 3600
_recent_by_ip: dict[str, deque[float]] = defaultdict(deque)


def _rate_limited(ip: str) -> bool:
    now = time.monotonic()
    hits = _recent_by_ip[ip]
    while hits and now - hits[0] > RATE_WINDOW_SECONDS:
        hits.popleft()
    if len(hits) >= RATE_LIMIT:
        return True
    hits.append(now)
    return False


class FeedbackRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    topic: str
    message: str = Field(min_length=1, max_length=2000)
    # Honeypot: hidden field humans never fill. Non-empty means bot.
    website: str = ""


class FeedbackResponse(BaseModel):
    ok: bool = True


@router.post("", response_model=FeedbackResponse)
def submit_feedback(
    body: FeedbackRequest,
    request: Request,
    db: Session = Depends(get_db),
    authorization: str | None = Header(default=None),
) -> FeedbackResponse:
    if body.topic not in TOPICS:
        raise HTTPException(status_code=422, detail="Unknown topic")
    if not EMAIL_RE.match(body.email):
        raise HTTPException(status_code=422, detail="Invalid email address")

    if body.website:
        # Bot filled the honeypot: pretend success, store nothing.
        logger.info("Dropping feedback submission that tripped the honeypot")
        return FeedbackResponse()

    ip = request.client.host if request.client else "unknown"
    if _rate_limited(ip):
        raise HTTPException(status_code=429, detail="Too many messages, try later")

    user = get_user_from_authorization_header(authorization, db, required=False)
    db.add(
        Feedback(
            user_id=str(user.id) if user else None,
            email=body.email.strip(),
            topic=body.topic,
            message=body.message.strip(),
        )
    )
    db.commit()
    return FeedbackResponse()
