"""Global safety net for unhandled exceptions.

Per-router code already sanitizes its own failures (see
``test_error_sanitization.py``). This middleware is the last line of defense for
anything that escapes those guards — a bug in a guard, an exception in a
dependency or middleware, or a future endpoint that forgets the pattern — so the
client always gets a sanitized JSON 500 instead of a bare ``Internal Server
Error``.

It is implemented as a middleware (rather than a bare
``@app.exception_handler(Exception)``) on purpose: a 500 handler runs in
Starlette's *outermost* ``ServerErrorMiddleware``, after the CORS and request-id
middleware have unwound — so its response would carry no CORS header, no
``x-request-id`` header, and a stale (default) request id. Placed *inside* those
middlewares, the sanitized response flows back out through them and picks all of
that up.
"""

from __future__ import annotations

import logging

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .logging_config import get_request_id

logger = logging.getLogger(__name__)

# Same generic, non-leaking message the routers already return.
GENERIC_ERROR_MESSAGE = "Unable to complete request. Please try again later."


class ExceptionSanitizerMiddleware:
    """Return a sanitized 500 for any otherwise-unhandled exception.

    Must be registered as the *innermost* user middleware (added before CORS /
    request-id) so its response travels back out through them.

    If the response has already started — e.g. a streaming endpoint that failed
    mid-stream — there is nothing to replace, so it re-raises and lets the
    connection tear down as before. Those streaming paths handle their own
    errors in-generator.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        response_started = False

        async def _send(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, receive, _send)
        except Exception:
            logger.exception("Unhandled exception; returning sanitized 500")
            if response_started:
                raise
            response = JSONResponse(
                status_code=500,
                content={
                    "detail": GENERIC_ERROR_MESSAGE,
                    "request_id": get_request_id(),
                },
            )
            await response(scope, receive, send)
