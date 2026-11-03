import io
import json
import logging

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from api import logging_config
from api.logging_config import (
    REDACTED,
    JsonLogFormatter,
    ReadableLogFormatter,
    RequestContextFilter,
    RequestIdMiddleware,
    redact,
    setup_logging,
)


def test_readable_formatter_aligns_log_sections():
    formatter = ReadableLogFormatter()
    lines = [
        formatter.format(
            logging.makeLogRecord(
                {
                    "name": logger_name,
                    "levelname": "INFO",
                    "msg": "message",
                    "request_id": request_id,
                }
            )
        )
        for logger_name, request_id in (
            ("uvicorn.error", "-"),
            ("a" * 50, "12345678-1234-1234-1234-123456789abc"),
        )
    ]

    assert len({line.index("request_id=") for line in lines}) == 1
    assert len({line.index(" | message") for line in lines}) == 1


def _format_record(logger_name: str, message: str, **extra):
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(JsonLogFormatter())
    handler.addFilter(RequestContextFilter())

    logger = logging.getLogger(logger_name)
    logger.handlers = [handler]
    logger.propagate = False
    logger.setLevel(logging.DEBUG)
    logger.info(message, extra=extra)
    return json.loads(stream.getvalue())


def test_redact_strips_secret_and_pii_keys():
    result = redact(
        "context",
        {
            "password": "hunter2",
            "api_key": "sk-live-123",
            "Authorization": "Bearer abc.def",
            "email": "real.person@example.com",
            "home_address": "1 Main St",
            "user_id": "usr_9j2f8s12",
            "nested": {"refresh_token": "xyz", "count": 3},
        },
    )

    assert result["password"] == REDACTED
    assert result["api_key"] == REDACTED
    assert result["Authorization"] == REDACTED
    assert result["email"] == REDACTED
    assert result["home_address"] == REDACTED
    assert result["nested"]["refresh_token"] == REDACTED
    # Non-sensitive fields survive untouched.
    assert result["user_id"] == "usr_9j2f8s12"
    assert result["nested"]["count"] == 3


def test_redact_scrubs_tokens_in_free_text_values():
    jwt = "eyJhbGciOiJIUzI1NientItOkay.payloadsegment.signaturepart"
    result = redact(
        "headers",
        {
            "x-custom": f"prefix Bearer {jwt} suffix",
            "note": "Basic QWxhZGRpbjpvcGVuc2VzYW1l done",
        },
    )

    assert "Bearer " + REDACTED in result["x-custom"]
    assert jwt not in result["x-custom"]
    assert "Basic " + REDACTED in result["note"]


def test_redact_dumps_and_scrubs_pydantic_models():
    from pydantic import BaseModel

    class FakeUser(BaseModel):
        id: str
        email: str
        access_token: str

    result = redact("user", FakeUser(id="u1", email="a@b.com", access_token="t"))

    assert result["id"] == "u1"
    assert result["email"] == REDACTED
    assert result["access_token"] == REDACTED


def test_json_formatter_redacts_extra_and_message():
    payload = _format_record(
        "tests.redaction",
        "auth header was Bearer sk-secret-token-value",
        password="hunter2",
        user_id="usr_42",
    )

    assert payload["password"] == REDACTED
    assert payload["user_id"] == "usr_42"
    assert "sk-secret-token-value" not in payload["message"]
    assert REDACTED in payload["message"]


@pytest.fixture(autouse=True)
def restore_root_logging():
    root_logger = logging.getLogger()
    original_handlers = list(root_logger.handlers)
    original_level = root_logger.level
    yield
    root_logger.handlers.clear()
    root_logger.handlers.extend(original_handlers)
    root_logger.setLevel(original_level)
    logging_config._LOGGING_CONFIGURED = False


def test_setup_logging_is_idempotent_and_routes_uvicorn(monkeypatch, tmp_path):
    monkeypatch.setenv("APP_ENV", "local")
    monkeypatch.setenv("LOG_FILE_PATH", str(tmp_path / "local_debug.jsonl"))

    uvicorn_logger = logging.getLogger("uvicorn")
    uvicorn_logger.addHandler(logging.StreamHandler(io.StringIO()))

    setup_logging(force=True)
    first_handlers = list(logging.getLogger().handlers)
    setup_logging()

    assert logging.getLogger().handlers == first_handlers
    for logger_name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logger = logging.getLogger(logger_name)
        assert logger.handlers == []
        assert logger.propagate is True


def test_local_file_logging_overwrites_and_keeps_debug(monkeypatch, tmp_path):
    log_path = tmp_path / "local_debug.jsonl"
    log_path.write_text("old log line\n", encoding="utf-8")
    monkeypatch.setenv("APP_ENV", "local")
    monkeypatch.setenv("LOG_FILE_PATH", str(log_path))
    monkeypatch.setenv("LOG_LEVEL", "INFO")
    monkeypatch.setenv("LOG_FILE_LEVEL", "DEBUG")

    setup_logging(force=True)
    logger = logging.getLogger("tests.logging")
    logger.debug("debug detail", extra={"count": 3})
    logger.info("visible flow")

    for handler in logging.getLogger().handlers:
        handler.flush()

    lines = log_path.read_text(encoding="utf-8").splitlines()
    assert "old log line" not in lines
    assert [json.loads(line)["message"] for line in lines] == [
        "debug detail",
        "visible flow",
    ]
    assert json.loads(lines[0])["count"] == 3


def test_json_formatter_handles_unserializable_extra_and_exceptions():
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(JsonLogFormatter())
    handler.addFilter(RequestContextFilter())

    logger = logging.getLogger("tests.json_formatter")
    logger.handlers = [handler]
    logger.propagate = False
    logger.setLevel(logging.DEBUG)

    try:
        raise ValueError("boom")
    except ValueError:
        logger.exception("format me", extra={"payload": object()})

    payload = json.loads(stream.getvalue())
    assert payload["message"] == "format me"
    assert "ValueError: boom" in payload["exception"]
    assert isinstance(payload["payload"], str)


def test_request_id_middleware_adds_header_and_context(monkeypatch, tmp_path):
    log_path = tmp_path / "request.jsonl"
    monkeypatch.setenv("APP_ENV", "local")
    monkeypatch.setenv("LOG_FILE_PATH", str(log_path))
    setup_logging(force=True)

    app = FastAPI()
    app.add_middleware(RequestIdMiddleware)

    @app.get("/ping")
    async def ping():
        logging.getLogger("tests.request").info("inside request")
        return {"ok": True}

    response = TestClient(app).get("/ping", headers={"X-Request-ID": "req-123"})

    assert response.status_code == 200
    assert response.headers["X-Request-ID"] == "req-123"

    for handler in logging.getLogger().handlers:
        handler.flush()

    entries = [
        json.loads(line) for line in log_path.read_text(encoding="utf-8").splitlines()
    ]
    assert any(
        entry["message"] == "inside request" and entry["request_id"] == "req-123"
        for entry in entries
    )
    request_log = next(
        entry for entry in entries if entry["message"] == "Request completed"
    )
    assert request_log["request_id"] == "req-123"
    assert request_log["status_code"] == 200
    assert request_log["request_path"] == "/ping"


def teardown_module():
    logging_config._LOGGING_CONFIGURED = False
