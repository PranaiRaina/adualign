"""Tests for the shared SSE error boundary."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from api.errors import GENERIC_ERROR_MESSAGE
from api.sse import DONE_EVENT, sse_error_boundary, text_event


class _FakeBudgetStack:
    def __init__(self):
        self.closed = 0

    async def aclose(self):
        self.closed += 1


async def _collect(gen):
    return [c async for c in gen]


async def test_sse_boundary_appends_done_on_success():
    ctx = SimpleNamespace(stream_terminated_early=False)
    stack = _FakeBudgetStack()
    finalized = []

    async def inner():
        yield "event: status\ndata: {}\n\n"
        yield text_event("hello")

    out = await _collect(
        sse_error_boundary(
            inner(),
            budget_ctx=ctx,
            budget_stack=stack,
            label="t",
            finalize=lambda: finalized.append(1),
        )
    )
    assert out[-1] == DONE_EVENT
    assert GENERIC_ERROR_MESSAGE not in "".join(out)
    assert ctx.stream_terminated_early is False  # completed normally
    assert stack.closed == 1
    assert finalized == [1]


async def test_sse_boundary_failure_without_text_emits_fallback_and_marks_early():
    ctx = SimpleNamespace(stream_terminated_early=False)
    stack = _FakeBudgetStack()

    async def inner():
        yield "event: status\ndata: {}\n\n"
        raise RuntimeError("boom")

    out = await _collect(
        sse_error_boundary(inner(), budget_ctx=ctx, budget_stack=stack, label="t")
    )
    body = "".join(out)
    assert GENERIC_ERROR_MESSAGE in body  # fallback shown (no answer text was sent)
    assert out[-1] == DONE_EVENT  # clean termination, not a silent death
    assert ctx.stream_terminated_early is True  # failed turn excluded from estimator
    assert stack.closed == 1


async def test_sse_boundary_failure_after_text_keeps_partial_answer():
    ctx = SimpleNamespace(stream_terminated_early=False)
    stack = _FakeBudgetStack()

    async def inner():
        yield text_event("partial answer")
        raise RuntimeError("boom")

    out = await _collect(
        sse_error_boundary(inner(), budget_ctx=ctx, budget_stack=stack, label="t")
    )
    body = "".join(out)
    assert "partial answer" in body
    assert GENERIC_ERROR_MESSAGE not in body  # don't clobber a partial answer
    assert out[-1] == DONE_EVENT
    assert ctx.stream_terminated_early is True


async def test_sse_boundary_reraises_cancellation_and_marks_early():
    ctx = SimpleNamespace(stream_terminated_early=False)
    stack = _FakeBudgetStack()

    async def inner():
        yield "event: status\ndata: {}\n\n"
        raise asyncio.CancelledError()

    with pytest.raises(asyncio.CancelledError):
        await _collect(
            sse_error_boundary(inner(), budget_ctx=ctx, budget_stack=stack, label="t")
        )
    assert ctx.stream_terminated_early is True
    assert stack.closed == 1
