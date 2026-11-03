"""Central logging setup for the backend application."""

from __future__ import annotations

import json
import logging
import os
import re
import sys
import uuid
from contextvars import ContextVar
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter
from typing import Any

from starlette.types import ASGIApp, Message, Receive, Scope, Send


DEFAULT_REQUEST_ID = "-"
LOCAL_ENV_NAMES = {"dev", "development", "local", "test"}
PRODUCTION_ENV_NAMES = {"prod", "production"}
UVICORN_LOGGER_NAMES = ("uvicorn", "uvicorn.error", "uvicorn.access")
# LiteLLM defaults its own ``LITELLM_LOG`` to DEBUG and attaches its own
# StreamHandler, which floods stdout with per-chunk streaming logs (and even raw
# prompt text via token_counter). Pin these loggers to WARNING so only genuine
# warnings/errors survive. Override with THIRD_PARTY_LOG_LEVEL if needed.
NOISY_THIRD_PARTY_LOGGER_NAMES = ("LiteLLM", "LiteLLM Router", "LiteLLM Proxy")

_request_id: ContextVar[str] = ContextVar("request_id", default=DEFAULT_REQUEST_ID)
_LOGGING_CONFIGURED = False

_STANDARD_RECORD_ATTRS = {
    "args",
    "asctime",
    "created",
    "exc_info",
    "exc_text",
    "filename",
    "funcName",
    "levelname",
    "levelno",
    "lineno",
    "module",
    "msecs",
    "message",
    "msg",
    "name",
    "pathname",
    "process",
    "processName",
    "relativeCreated",
    "stack_info",
    "thread",
    "threadName",
    "taskName",
}


REDACTED = "[REDACTED]"
_MAX_REDACTION_DEPTH = 8

# Substrings that mark a field's value as a credential or secret. A key that
# contains any of these (case-insensitive) has its value fully redacted.
_SECRET_KEY_SUBSTRINGS = (
    "password",
    "passwd",
    "pwd",
    "secret",
    "token",
    "apikey",
    "api_key",
    "api-key",
    "accesskey",
    "access_key",
    "privatekey",
    "private_key",
    "authorization",
    "credential",
    "session",
    "cookie",
    "bearer",
)

# Substrings/keys that mark a field as raw PII. We log anonymized UUIDs instead
# (e.g. user_id), so any of these reaching the logger is redacted defensively.
_PII_KEY_SUBSTRINGS = (
    "email",
    "phone",
    "mobile",
    "ssn",
    "social_security",
    "credit_card",
    "card_number",
    "cardnumber",
    "cvv",
    "iban",
    "passport",
    "date_of_birth",
    "birthdate",
    "first_name",
    "last_name",
    "full_name",
)
_PII_EXACT_KEYS = frozenset(
    {
        "address",
        "street",
        "home_address",
        "street_address",
        "mailing_address",
        "billing_address",
    }
)

# Value-level scrubbing: catches tokens embedded in free text (e.g. a header
# dict or request body logged as a string) regardless of the field name.
_TEXT_SCRUBBERS: tuple[tuple[re.Pattern[str], str], ...] = (
    # JSON Web Tokens (three base64url segments).
    (
        re.compile(r"\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]+"),
        REDACTED,
    ),
    # "Authorization: Bearer <token>" style values.
    (re.compile(r"(?i)\b(bearer)\s+[A-Za-z0-9._~+/\-]+=*"), r"\1 " + REDACTED),
    # HTTP Basic auth values.
    (re.compile(r"(?i)\b(basic)\s+[A-Za-z0-9+/]{8,}=*"), r"\1 " + REDACTED),
)


def get_request_id() -> str:
    return _request_id.get()


def _is_sensitive_key(key: str) -> bool:
    lowered = key.lower()
    if any(token in lowered for token in _SECRET_KEY_SUBSTRINGS):
        return True
    if any(token in lowered for token in _PII_KEY_SUBSTRINGS):
        return True
    return lowered in _PII_EXACT_KEYS


def _scrub_text(text: str) -> str:
    for pattern, replacement in _TEXT_SCRUBBERS:
        text = pattern.sub(replacement, text)
    return text


def redact(key: str, value: Any, _depth: int = 0) -> Any:
    """Recursively redact secrets/PII from a structured log value.

    Sensitive keys are dropped entirely; Pydantic models are dumped first so
    their fields are inspected; free-text strings are scrubbed for tokens.
    """

    if _is_sensitive_key(key):
        return REDACTED

    if hasattr(value, "model_dump"):
        try:
            value = value.model_dump(mode="json")
        except Exception:
            return REDACTED

    if _depth >= _MAX_REDACTION_DEPTH:
        return value

    if isinstance(value, dict):
        return {k: redact(str(k), v, _depth + 1) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [redact(key, item, _depth + 1) for item in value]
    if isinstance(value, str):
        return _scrub_text(value)
    return value


class RequestContextFilter(logging.Filter):
    """Attach request-scoped context to every emitted log record."""

    def filter(self, record: logging.LogRecord) -> bool:
        if not getattr(record, "request_id", None):
            record.request_id = get_request_id()
        return True


class JsonLogFormatter(logging.Formatter):
    """Format log records as newline-delimited JSON."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": self.formatTime(record),
            "level": record.levelname,
            "logger": record.name,
            "message": _scrub_text(record.getMessage()),
            "request_id": getattr(record, "request_id", DEFAULT_REQUEST_ID),
            "module": record.module,
            "path": record.pathname,
            "function": record.funcName,
            "line": record.lineno,
        }

        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        if record.stack_info:
            payload["stack"] = self.formatStack(record.stack_info)

        payload.update(_extract_extra_fields(record))
        return json.dumps(payload, default=_safe_json_value, ensure_ascii=False)

    def formatTime(
        self,
        record: logging.LogRecord,
        datefmt: str | None = None,
    ) -> str:
        if datefmt:
            return super().formatTime(record, datefmt)
        timestamp = datetime.fromtimestamp(record.created, tz=timezone.utc)
        return timestamp.isoformat(timespec="milliseconds").replace("+00:00", "Z")


class ReadableLogFormatter(logging.Formatter):
    """Format local console logs for quick human scanning."""

    default_time_format = "%Y-%m-%d %H:%M:%S"
    default_msec_format = "%s,%03d"

    def __init__(self) -> None:
        super().__init__(
            "%(asctime)s | %(levelname)-8.8s | [%(name)-36.36s] | "
            "request_id=%(request_id)-36.36s | %(message)s"
        )

    def format(self, record: logging.LogRecord) -> str:
        return _scrub_text(super().format(record))


class RequestIdMiddleware:
    """ASGI middleware that keeps request context active through streaming."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app
        self.logger = logging.getLogger("api.request")

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request_id = _get_incoming_request_id(scope) or str(uuid.uuid4())
        token = _request_id.set(request_id)
        started_at = perf_counter()
        status_code = 500

        async def send_with_request_id(message: Message) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = int(message["status"])
                headers = [
                    header
                    for header in message.get("headers", [])
                    if header[0].lower() != b"x-request-id"
                ]
                headers.append((b"x-request-id", request_id.encode("latin-1")))
                message = {**message, "headers": headers}
            await send(message)

        try:
            await self.app(scope, receive, send_with_request_id)
        except Exception:
            self.logger.exception(
                "Request failed",
                extra=_request_log_extra(scope, status_code, started_at),
            )
            raise
        else:
            self.logger.info(
                "Request completed",
                extra=_request_log_extra(scope, status_code, started_at),
            )
        finally:
            _request_id.reset(token)


def setup_logging(*, force: bool = False) -> None:
    """Configure root, app, and Uvicorn loggers."""

    global _LOGGING_CONFIGURED
    if _LOGGING_CONFIGURED and not force:
        return

    app_env = os.getenv("APP_ENV", "local").strip().lower()
    is_production = app_env in PRODUCTION_ENV_NAMES
    log_to_file = _env_bool("LOG_TO_FILE", default=not is_production)

    root_logger = logging.getLogger()
    root_logger.handlers.clear()
    root_logger.setLevel(logging.DEBUG)

    context_filter = RequestContextFilter()
    console_handler = _build_console_handler(app_env, context_filter)
    root_logger.addHandler(console_handler)

    if log_to_file:
        file_handler = _build_file_handler(context_filter)
        root_logger.addHandler(file_handler)

    _route_uvicorn_logs_to_root()
    _quiet_noisy_third_party_loggers()
    _LOGGING_CONFIGURED = True


def _build_console_handler(
    app_env: str,
    context_filter: RequestContextFilter,
) -> logging.Handler:
    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(_level_from_env("LOG_LEVEL", default="INFO"))
    if app_env in LOCAL_ENV_NAMES:
        handler.setFormatter(ReadableLogFormatter())
    else:
        handler.setFormatter(JsonLogFormatter())
    handler.addFilter(context_filter)
    return handler


def _build_file_handler(context_filter: RequestContextFilter) -> logging.Handler:
    log_file_path = Path(os.getenv("LOG_FILE_PATH", "logs/local_debug.jsonl"))
    log_file_path.parent.mkdir(parents=True, exist_ok=True)

    handler = logging.FileHandler(log_file_path, mode="w", encoding="utf-8")
    handler.setLevel(_level_from_env("LOG_FILE_LEVEL", default="DEBUG"))
    handler.setFormatter(JsonLogFormatter())
    handler.addFilter(context_filter)
    return handler


def _route_uvicorn_logs_to_root() -> None:
    for logger_name in UVICORN_LOGGER_NAMES:
        logger = logging.getLogger(logger_name)
        logger.handlers.clear()
        logger.propagate = True


def _quiet_noisy_third_party_loggers() -> None:
    """Silence LiteLLM's DEBUG flood.

    LiteLLM creates its own StreamHandler and, with ``LITELLM_LOG`` unset,
    defaults the level to DEBUG — so it bypasses our console handler entirely.
    We drop its handlers, raise the level (default WARNING), and let records
    propagate through our root handlers so they share our format + request id.
    Setting the level explicitly survives a later ``import litellm`` (which would
    otherwise re-inherit the root logger's DEBUG level).
    """
    level = _level_from_env("THIRD_PARTY_LOG_LEVEL", default="WARNING")
    for logger_name in NOISY_THIRD_PARTY_LOGGER_NAMES:
        logger = logging.getLogger(logger_name)
        logger.handlers.clear()
        logger.propagate = True
        logger.setLevel(level)


def _level_from_env(env_name: str, *, default: str) -> int:
    raw_level = os.getenv(env_name, default).strip().upper()
    level = logging.getLevelName(raw_level)
    if isinstance(level, int):
        return level
    return logging.getLevelName(default)


def _env_bool(env_name: str, *, default: bool) -> bool:
    raw_value = os.getenv(env_name)
    if raw_value is None:
        return default
    return raw_value.strip().lower() in {"1", "true", "yes", "on"}


def _extract_extra_fields(record: logging.LogRecord) -> dict[str, Any]:
    extra: dict[str, Any] = {}
    for key, value in record.__dict__.items():
        if key in _STANDARD_RECORD_ATTRS or key.startswith("_"):
            continue
        if key == "request_id":
            continue
        extra[key] = redact(key, value)
    return extra


def _safe_json_value(value: Any) -> Any:
    if hasattr(value, "model_dump"):
        try:
            return redact("", value.model_dump(mode="json"))
        except Exception:
            pass
    return _scrub_text(str(value))


def _get_incoming_request_id(scope: Scope) -> str | None:
    for key, value in scope.get("headers", []):
        if key.lower() == b"x-request-id":
            decoded = value.decode("latin-1").strip()
            return decoded or None
    return None


def _request_log_extra(
    scope: Scope,
    status_code: int,
    started_at: float,
) -> dict[str, Any]:
    return {
        "method": scope.get("method"),
        "request_path": scope.get("path"),
        "status_code": status_code,
        "duration_ms": round((perf_counter() - started_at) * 1000, 2),
    }
