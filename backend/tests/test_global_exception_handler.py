"""Tests for the global unhandled-exception safety net."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient

from api.errors import GENERIC_ERROR_MESSAGE, ExceptionSanitizerMiddleware
from api.logging_config import RequestIdMiddleware


def _build_app() -> FastAPI:
    """Mirror the real app's middleware stack ordering."""
    app = FastAPI()

    @app.get("/boom")
    async def boom():
        raise RuntimeError("secret internal detail")

    # ExceptionSanitizer must be INNERMOST (added first) so its response flows
    # back out through CORS + request-id, picking up their headers.
    app.add_middleware(ExceptionSanitizerMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(RequestIdMiddleware)
    return app


def test_unhandled_exception_returns_sanitized_500():
    client = TestClient(_build_app(), raise_server_exceptions=False)
    resp = client.get("/boom")

    assert resp.status_code == 500
    body = resp.json()
    assert body["detail"] == GENERIC_ERROR_MESSAGE
    # The internal exception text must never reach the client.
    assert "secret internal detail" not in resp.text


def test_unhandled_exception_response_carries_cors_header():
    client = TestClient(_build_app(), raise_server_exceptions=False)
    resp = client.get("/boom", headers={"Origin": "http://example.com"})

    assert resp.status_code == 500
    # Without this, the browser shows a misleading CORS error instead of the 500.
    assert "access-control-allow-origin" in {k.lower() for k in resp.headers}


def test_unhandled_exception_includes_correlatable_request_id():
    client = TestClient(_build_app(), raise_server_exceptions=False)
    resp = client.get("/boom")

    body = resp.json()
    header_id = resp.headers.get("x-request-id")
    assert header_id
    assert body["request_id"] == header_id  # body id matches the header for support


def test_real_app_registers_the_safety_net():
    from api.main import app

    assert any(m.cls is ExceptionSanitizerMiddleware for m in app.user_middleware)
