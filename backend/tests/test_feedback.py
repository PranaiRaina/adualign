"""Tests for the public /feedback endpoint (api/routers/feedback.py)."""

import os
from unittest.mock import MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

os.environ.setdefault("SUPABASE_DATABASE_URL", "sqlite:///./test-feedback.db")

from api.database.core import get_db
from api.routers import feedback as feedback_module
from api.routers.feedback import router as feedback_router

VALID = {
    "email": "sam@example.com",
    "topic": "bug",
    "message": "The map is upside down",
}


def _build_test_app() -> tuple[FastAPI, MagicMock]:
    app = FastAPI()
    app.include_router(feedback_router)
    db = MagicMock()
    app.dependency_overrides[get_db] = lambda: db
    return app, db


def setup_function() -> None:
    feedback_module._recent_by_ip.clear()


def test_valid_submission_inserts_row():
    app, db = _build_test_app()
    resp = TestClient(app).post("/feedback", json=VALID)

    assert resp.status_code == 200
    assert resp.json() == {"ok": True}
    db.add.assert_called_once()
    db.commit.assert_called_once()
    row = db.add.call_args.args[0]
    assert row.user_id is None
    assert row.email == "sam@example.com"


def test_honeypot_drops_silently():
    app, db = _build_test_app()
    resp = TestClient(app).post("/feedback", json={**VALID, "website": "spam.biz"})

    assert resp.status_code == 200
    db.add.assert_not_called()


def test_bad_topic_and_bad_email_rejected():
    app, _ = _build_test_app()
    client = TestClient(app)

    assert client.post("/feedback", json={**VALID, "topic": "rant"}).status_code == 422
    assert (
        client.post("/feedback", json={**VALID, "email": "not-an-email"}).status_code
        == 422
    )
    assert (
        client.post("/feedback", json={**VALID, "message": "x" * 2001}).status_code
        == 422
    )


def test_rate_limit_kicks_in():
    app, _ = _build_test_app()
    client = TestClient(app)

    for _ in range(feedback_module.RATE_LIMIT):
        assert client.post("/feedback", json=VALID).status_code == 200
    assert client.post("/feedback", json=VALID).status_code == 429
