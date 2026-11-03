"""Tests for the shared LLM resilience layer (api/llm)."""

from __future__ import annotations

import asyncio

import litellm
import pytest

from api.llm import tiers
from api.llm.factory import build_chat_llm
from api.llm.genai_client import genai_http_options
from api.llm.litellm_client import (
    LLMStreamStalled,
    _is_transient,
    acompletion_resilient,
    astream_resilient,
)
from api.llm.tiers import FAST, LONG, STANDARD, LLMTier

# A fast tier so timeout-based tests run in milliseconds, not seconds.
_TEST_TIER = LLMTier(name="test", timeout_s=0.05, retries=2, stall_timeout_s=0.05)


# ── tiers ───────────────────────────────────────────────────────────────────
def test_tier_values():
    assert (FAST.timeout_s, FAST.retries, FAST.stall_timeout_s) == (15.0, 3, 15.0)
    assert (STANDARD.timeout_s, STANDARD.retries, STANDARD.stall_timeout_s) == (
        45.0,
        2,
        30.0,
    )
    assert (LONG.timeout_s, LONG.retries, LONG.stall_timeout_s) == (180.0, 1, 60.0)


# ── retry classification (_is_transient) ──────────────────────────────────────
def test_is_transient_retries_transient_failures():
    assert _is_transient(litellm.BadGatewayError("m", "x", "y"))  # 502 — the bug
    assert _is_transient(litellm.ServiceUnavailableError("m", "x", "y"))  # 503
    assert _is_transient(litellm.InternalServerError("m", "x", "y"))  # 500
    assert _is_transient(litellm.RateLimitError("m", "x", "y"))  # 429
    assert _is_transient(litellm.APIConnectionError("m", "x", "y"))
    assert _is_transient(litellm.Timeout("m", "x", "y"))  # 408


def test_is_transient_skips_permanent_and_slow():
    assert not _is_transient(litellm.BadRequestError("m", "x", "y"))  # 400
    assert not _is_transient(litellm.AuthenticationError("m", "x", "y"))  # 401
    assert not _is_transient(litellm.ContextWindowExceededError("m", "x", "y"))  # 400
    # A slow-but-healthy first token surfaces as asyncio.TimeoutError, NOT a
    # transport failure — it must not be retried.
    assert not _is_transient(asyncio.TimeoutError())
    assert not _is_transient(RuntimeError("boom"))


# ── build_chat_llm (ChatOpenAI @ OpenRouter) ────────────────────────────────────────
def test_build_chat_llm_sets_timeout_and_attempts():
    llm = build_chat_llm(tier=FAST, api_key="test-key")
    assert llm.request_timeout == 15.0
    # ChatOpenAI max_retries is *additional* attempts, so we pass tier.retries.
    assert llm.max_retries == FAST.retries


def test_build_chat_llm_attempts_per_tier():
    assert build_chat_llm(tier=STANDARD, api_key="k").max_retries == STANDARD.retries
    assert build_chat_llm(tier=LONG, api_key="k").max_retries == LONG.retries


def test_build_chat_llm_structured_output_wraps():
    from langchain_openai import ChatOpenAI
    from pydantic import BaseModel

    class Schema(BaseModel):
        x: int

    plain = build_chat_llm(tier=FAST, api_key="k")
    wrapped = build_chat_llm(tier=FAST, api_key="k", structured_output=Schema)
    assert isinstance(plain, ChatOpenAI)
    assert not isinstance(wrapped, ChatOpenAI)


def test_build_chat_llm_requires_api_key(monkeypatch):
    monkeypatch.setattr("api.llm.factory.get_openrouter_key", lambda: None)
    with pytest.raises(RuntimeError):
        build_chat_llm(tier=FAST)


def test_build_chat_llm_targets_openrouter_with_reasoning():
    from api.rate_limiting.llm_pricing import OPENROUTER_BASE_URL, OPENROUTER_CHAT_MODEL

    llm = build_chat_llm(tier=FAST, api_key="k")
    assert str(llm.openai_api_base) == OPENROUTER_BASE_URL
    assert llm.model_name == OPENROUTER_CHAT_MODEL
    assert llm.extra_body["reasoning"] == {"effort": "medium"}
    # Pin routing to the verified-good provider allowlist, cheapest-first.
    assert llm.extra_body["provider"]["only"][0] == "gmicloud"
    assert llm.extra_body["provider"]["sort"] == "throughput"


def test_build_chat_llm_minimal_reasoning_level():
    from api.rate_limiting.llm_pricing import REASONING_MINIMAL

    llm = build_chat_llm(tier=FAST, api_key="k", reasoning_level=REASONING_MINIMAL)
    assert llm.extra_body["reasoning"] == {"enabled": False}


# ── genai http options (raw google.genai) ─────────────────────────────────────
def test_genai_http_options_carry_timeout_and_exponential_retry():
    opts = genai_http_options(LONG)
    assert opts.timeout == 180_000  # milliseconds
    ro = opts.retry_options
    assert ro.attempts == 2  # retries + 1
    assert ro.exp_base == 2.0
    assert ro.jitter == 1.0
    assert 429 in ro.http_status_codes
    assert 503 in ro.http_status_codes


# ── LiteLLM resilient wrappers ────────────────────────────────────────────────
@pytest.fixture(autouse=True)
def _zero_backoff(monkeypatch):
    """Make exponential backoff instant so retry tests don't actually sleep."""
    monkeypatch.setattr(tiers, "BACKOFF_INITIAL_S", 0.0)
    monkeypatch.setattr(tiers, "BACKOFF_MAX_S", 0.0)
    monkeypatch.setattr(tiers, "BACKOFF_JITTER_S", 0.0)


async def test_acompletion_resilient_retries_transient(monkeypatch):
    calls = {"n": 0}
    sentinel = object()

    async def fake(**kwargs):
        calls["n"] += 1
        if calls["n"] < 3:
            raise litellm.Timeout("boom", "openrouter/x", "openrouter")
        return sentinel

    monkeypatch.setattr(litellm, "acompletion", fake)
    result = await acompletion_resilient(
        tier=_TEST_TIER, model="openrouter/x", messages=[]
    )
    assert result is sentinel
    assert calls["n"] == 3


async def test_acompletion_resilient_passes_timeout_and_disables_native_retry(
    monkeypatch,
):
    captured = {}

    async def fake(**kwargs):
        captured.update(kwargs)
        return object()

    monkeypatch.setattr(litellm, "acompletion", fake)
    await acompletion_resilient(tier=STANDARD, model="openrouter/x", messages=[])
    assert captured["timeout"] == 45.0
    assert captured["num_retries"] == 0


async def test_acompletion_resilient_does_not_retry_non_transient(monkeypatch):
    calls = {"n": 0}

    async def fake(**kwargs):
        calls["n"] += 1
        raise litellm.BadRequestError("bad", "openrouter/x", "openrouter")

    monkeypatch.setattr(litellm, "acompletion", fake)
    with pytest.raises(litellm.BadRequestError):
        await acompletion_resilient(tier=_TEST_TIER, model="openrouter/x", messages=[])
    assert calls["n"] == 1


# ── LiteLLM streaming ─────────────────────────────────────────────────────────
class _FakeStream:
    """Async-iterable stand-in for a LiteLLM streaming response.

    ``hang_indices`` are 0-based __anext__ positions that block forever
    (to simulate a stalled/never-arriving chunk).
    """

    def __init__(self, chunks, hang_indices=()):
        self._chunks = list(chunks)
        self._i = 0
        self._hang = set(hang_indices)
        self.closed = 0

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self._i in self._hang:
            await asyncio.Event().wait()  # never returns
        if self._i >= len(self._chunks):
            raise StopAsyncIteration
        chunk = self._chunks[self._i]
        self._i += 1
        return chunk

    async def aclose(self):
        # Mirrors litellm's CustomStreamWrapper.aclose, which releases the
        # upstream HTTP connection.
        self.closed += 1


async def test_astream_resilient_yields_chunks(monkeypatch):
    async def fake(**kwargs):
        return _FakeStream(["a", "b", "c"])

    monkeypatch.setattr(litellm, "acompletion", fake)
    out = [
        c
        async for c in astream_resilient(
            tier=_TEST_TIER, model="openrouter/x", messages=[]
        )
    ]
    assert out == ["a", "b", "c"]


async def test_astream_resilient_retries_transient_open_error(monkeypatch):
    """A transient transport error while opening the stream is retried."""
    calls = {"n": 0}

    async def fake(**kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            raise litellm.BadGatewayError("flaky gateway", "x", "y")  # 502, transient
        return _FakeStream(["x", "y"])

    monkeypatch.setattr(litellm, "acompletion", fake)
    out = [
        c
        async for c in astream_resilient(
            tier=_TEST_TIER, model="openrouter/x", messages=[]
        )
    ]
    assert out == ["x", "y"]
    assert calls["n"] == 2


async def test_astream_resilient_slow_first_token_aborts_without_rerun(monkeypatch):
    """A slow-but-healthy first token must NOT be retried (no duplicate generation)."""
    calls = {"n": 0}

    async def fake(**kwargs):
        calls["n"] += 1
        return _FakeStream(["x"], hang_indices={0})  # first token never arrives (slow)

    monkeypatch.setattr(litellm, "acompletion", fake)
    with pytest.raises(LLMStreamStalled):
        async for _ in astream_resilient(
            tier=_TEST_TIER, model="openrouter/x", messages=[]
        ):
            pass
    assert calls["n"] == 1  # opened exactly once — generation never re-run


async def test_astream_resilient_stall_watchdog_aborts(monkeypatch):
    async def fake(**kwargs):
        return _FakeStream(["first", "second"], hang_indices={1})

    monkeypatch.setattr(litellm, "acompletion", fake)
    received = []
    with pytest.raises(LLMStreamStalled):
        async for c in astream_resilient(
            tier=STANDARD, model="openrouter/x", messages=[], stall_timeout_s=0.05
        ):
            received.append(c)
    assert received == ["first"]  # no mid-stream retry; aborts after the good chunk


async def test_astream_resilient_uses_tier_stall_timeout(monkeypatch):
    """With no explicit override, the tier's stall_timeout_s bounds inter-chunk gaps."""
    tier = LLMTier(name="t", timeout_s=5.0, retries=0, stall_timeout_s=0.05)

    async def fake(**kwargs):
        return _FakeStream(["first", "second"], hang_indices={1})

    monkeypatch.setattr(litellm, "acompletion", fake)
    received = []
    with pytest.raises(LLMStreamStalled):
        async for c in astream_resilient(tier=tier, model="openrouter/x", messages=[]):
            received.append(c)
    assert received == ["first"]


async def test_astream_resilient_empty_stream_ends_cleanly(monkeypatch):
    async def fake(**kwargs):
        return _FakeStream([])

    monkeypatch.setattr(litellm, "acompletion", fake)
    out = [
        c
        async for c in astream_resilient(
            tier=_TEST_TIER, model="openrouter/x", messages=[]
        )
    ]
    assert out == []


# ── stream cleanup: the wrapper must always release the HTTP connection ────────
async def test_astream_resilient_closes_stream_on_normal_completion(monkeypatch):
    stream = _FakeStream(["a", "b"])

    async def fake(**kwargs):
        return stream

    monkeypatch.setattr(litellm, "acompletion", fake)
    out = [
        c
        async for c in astream_resilient(
            tier=_TEST_TIER, model="openrouter/x", messages=[]
        )
    ]
    assert out == ["a", "b"]
    assert stream.closed == 1


async def test_astream_resilient_closes_stream_on_empty(monkeypatch):
    stream = _FakeStream([])

    async def fake(**kwargs):
        return stream

    monkeypatch.setattr(litellm, "acompletion", fake)
    async for _ in astream_resilient(
        tier=_TEST_TIER, model="openrouter/x", messages=[]
    ):
        pass
    assert stream.closed == 1


async def test_astream_resilient_closes_stream_on_slow_first_token(monkeypatch):
    stream = _FakeStream(["x"], hang_indices={0})

    async def fake(**kwargs):
        return stream

    monkeypatch.setattr(litellm, "acompletion", fake)
    with pytest.raises(LLMStreamStalled):
        async for _ in astream_resilient(
            tier=_TEST_TIER, model="openrouter/x", messages=[]
        ):
            pass
    assert stream.closed == 1


async def test_astream_resilient_closes_stream_on_stall(monkeypatch):
    stream = _FakeStream(["first", "second"], hang_indices={1})

    async def fake(**kwargs):
        return stream

    monkeypatch.setattr(litellm, "acompletion", fake)
    with pytest.raises(LLMStreamStalled):
        async for _ in astream_resilient(
            tier=STANDARD, model="openrouter/x", messages=[], stall_timeout_s=0.05
        ):
            pass
    assert stream.closed == 1


async def test_astream_resilient_closes_stream_on_early_consumer_exit(monkeypatch):
    """A client disconnect (consumer stops early) must still close the stream."""
    stream = _FakeStream(["a", "b", "c"])

    async def fake(**kwargs):
        return stream

    monkeypatch.setattr(litellm, "acompletion", fake)
    gen = astream_resilient(tier=_TEST_TIER, model="openrouter/x", messages=[])
    assert await gen.__anext__() == "a"
    await gen.aclose()  # simulate the event loop tearing down the generator
    assert stream.closed == 1


async def test_astream_resilient_closes_leaked_stream_on_transient_retry(monkeypatch):
    """A transient error on the first read must close that stream before re-opening."""
    streams = []

    async def fake(**kwargs):
        if not streams:
            s = _FakeStream(["never"])

            async def boom():
                raise litellm.BadGatewayError("flaky", "x", "y")  # 502, transient

            s.__anext__ = boom  # fail on the first read, after the stream opened
            streams.append(s)
            return s
        s = _FakeStream(["x", "y"])
        streams.append(s)
        return s

    monkeypatch.setattr(litellm, "acompletion", fake)
    out = [
        c
        async for c in astream_resilient(
            tier=_TEST_TIER, model="openrouter/x", messages=[]
        )
    ]
    assert out == ["x", "y"]
    # The first (failed) stream was closed; the second ran to completion and closed.
    assert streams[0].closed == 1
    assert streams[1].closed == 1
