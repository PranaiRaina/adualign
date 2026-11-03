"""Shared Server-Sent-Events streaming helpers.

:func:`sse_error_boundary` is the single place that turns a *content-only* SSE
generator into a safe stream: it appends the terminal ``done`` event, emits a
sanitized fallback if the stream fails before any answer text was sent, re-raises
client disconnects, marks failed/aborted turns so they're excluded from the cost
estimator, and runs budget + finalize cleanup. The orchestrator and direct-RAG
streaming endpoints both pipe their generators through it so this error handling
lives in exactly one place.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import AsyncIterator, Callable

from .errors import GENERIC_ERROR_MESSAGE

logger = logging.getLogger(__name__)

DONE_EVENT = "event: done\ndata: {}\n\n"


def text_event(text: str) -> str:
    """Format an answer-text SSE chunk — a bare ``data:`` line (no event name)."""
    return f"data: {json.dumps({'text': text})}\n\n"


async def sse_error_boundary(
    inner: AsyncIterator[str],
    *,
    budget_ctx,
    budget_stack,
    label: str,
    finalize: Callable[[], object] | None = None,
) -> AsyncIterator[str]:
    """Wrap a content-only SSE generator with termination + error handling.

    Yields every chunk from ``inner`` — tracking whether answer text (a bare
    ``data:`` chunk; every other event is ``event:``-prefixed) was sent — then a
    terminal ``done`` event. On a mid-stream failure it emits a sanitized
    fallback (only when no text was sent yet) and a ``done`` event so the client
    closes cleanly instead of seeing a frozen response. A client disconnect
    (``CancelledError``) is re-raised. A failed or disconnected turn is marked
    ``stream_terminated_early`` so it is excluded from the rolling-average cost
    estimator, and the budget stack + optional ``finalize`` always run.
    """
    completed = False
    sent_text = False
    try:
        async for chunk in inner:
            if chunk.startswith("data:"):
                sent_text = True
            yield chunk
        yield DONE_EVENT
        completed = True
    except asyncio.CancelledError:
        logger.info("Client disconnected during %s", label)
        raise
    except Exception:
        logger.exception("%s failed", label)
        if not sent_text:
            yield text_event(GENERIC_ERROR_MESSAGE)
        yield DONE_EVENT
        # Intentionally leave completed=False so the finally marks the failed
        # turn terminated-early (excluded from the cost estimator).
    finally:
        if budget_stack is not None:
            if budget_ctx is not None and not completed:
                budget_ctx.stream_terminated_early = True
            await budget_stack.aclose()
        if finalize is not None:
            finalize()
