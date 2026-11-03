"""Resilient LiteLLM wrappers: timeout + exponential-backoff retries.

LiteLLM's native ``num_retries`` only does exponential backoff for rate limits
(constant retry, no jitter, for timeouts/5xx), so we drive retries ourselves with
tenacity and pass ``num_retries=0`` to LiteLLM to avoid double-retrying.

Streaming is handled safely. While opening the stream and waiting for the first
token, only genuine *transport* failures are retried (re-opening is cheap —
nothing has been generated yet). A slow first token is the model thinking, not a
failure, so it is NOT retried: we wait up to the tier timeout, then abort with
:class:`LLMStreamStalled` rather than re-running the generation. Once the first
chunk is yielded, a per-chunk stall watchdog (``tier.stall_timeout_s``) aborts a
wedged stream but never retries (that would double-send tokens).
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, AsyncIterator, cast

import litellm
import tenacity

from api.rate_limiting.llm_pricing import (
    CHAT_COMPLETION_MODEL,
    LITELLM_CHAT_MODEL,
    LLM_PRICING,
)

from . import tiers
from .tiers import LLMTier

logger = logging.getLogger(__name__)


def _register_litellm_model_pricing() -> None:
    """Teach LiteLLM our deepseek-v4-flash rates so its internal cost calculator
    stops raising "model isn't mapped yet" on every call.

    We never consume LiteLLM's computed cost (we read OpenRouter's actual cost, or
    fall back to our own static table), but its calculator runs on every request
    and floods the logs with errors for the unmapped ``openrouter/`` id. We register
    *only* ``LITELLM_CHAT_MODEL`` — the exact id LiteLLM uses for cost calc on this
    path — because registering the bare ``deepseek/deepseek-v4-flash`` would clobber
    LiteLLM's own native entry for that key. Rates come from ``LLM_PRICING`` (single
    source of truth). ``register_model`` is idempotent and safe to call at import.
    """
    # micros-per-million-tokens -> USD-per-token: divide by 1e6 (micros->USD) and
    # by 1e6 (per-million->per-token) == divide by 1e12. The pricing lookup is
    # inside the try so a future reshape of LLM_PRICING degrades to log noise
    # rather than an import-time crash of the whole LLM stack.
    try:
        pricing = LLM_PRICING[CHAT_COMPLETION_MODEL]
        litellm.register_model(
            {
                LITELLM_CHAT_MODEL: {
                    "input_cost_per_token": pricing["input_micros_per_million_tokens"]
                    / 1e12,
                    "output_cost_per_token": pricing["output_micros_per_million_tokens"]
                    / 1e12,
                    "cache_read_input_token_cost": pricing[
                        "cache_read_micros_per_million_tokens"
                    ]
                    / 1e12,
                    "litellm_provider": "openrouter",
                    "mode": "chat",
                }
            }
        )
    except Exception:  # never let cost-map registration break LLM calls
        logger.debug("LiteLLM model pricing registration failed", exc_info=True)


_register_litellm_model_pricing()


class LLMStreamStalled(TimeoutError):
    """Raised when a streaming response stalls (no chunk within the watchdog)."""


async def _aclose_quietly(stream: Any) -> None:
    """Best-effort close of a LiteLLM stream wrapper.

    The real ``litellm`` ``CustomStreamWrapper`` exposes ``aclose`` to release the
    upstream HTTP connection; test fakes and other iterables may not. Closing is
    best-effort — a failure here must never mask the real outcome of the call.
    """
    aclose = getattr(stream, "aclose", None)
    if aclose is None:
        return
    try:
        await aclose()
    except Exception:
        logger.debug("Failed to close LLM stream cleanly", exc_info=True)


def _is_transient(exc: BaseException) -> bool:
    """Retry transport failures, classified by HTTP status code.

    Uses the same ``RETRYABLE_STATUS_CODES`` (408/429/500/502/503/504) that drive
    the genai/LangChain ``HttpRetryOptions`` — one source of truth across all
    three SDK paths, so 502/504 etc. can't be missed. Connection-level failures
    have no usable status code, so they're matched by type. A slow first token
    surfaces as ``asyncio.TimeoutError`` and is deliberately *not* transient — it
    means "slow," not "failed," and must not trigger a re-run.
    """
    if getattr(exc, "status_code", None) in tiers.RETRYABLE_STATUS_CODES:
        return True
    return isinstance(exc, (litellm.APIConnectionError, litellm.Timeout))


def _async_retryer(tier: LLMTier) -> tenacity.AsyncRetrying:
    # Backoff settings are read from the module at call time so tests can zero them.
    return tenacity.AsyncRetrying(
        wait=tenacity.wait_exponential_jitter(
            initial=tiers.BACKOFF_INITIAL_S,
            max=tiers.BACKOFF_MAX_S,
            exp_base=tiers.BACKOFF_EXP_BASE,
            jitter=tiers.BACKOFF_JITTER_S,
        ),
        stop=tenacity.stop_after_attempt(tier.retries + 1),
        retry=tenacity.retry_if_exception(_is_transient),
        reraise=True,
    )


async def acompletion_resilient(*, tier: LLMTier, **kwargs: Any) -> Any:
    """``litellm.acompletion`` with the tier's timeout + exponential retries."""

    async def _call() -> Any:
        return await litellm.acompletion(
            timeout=tier.timeout_s,
            num_retries=0,
            **kwargs,
        )

    return await _async_retryer(tier)(_call)


async def astream_resilient(
    *,
    tier: LLMTier,
    stall_timeout_s: float | None = None,
    **kwargs: Any,
) -> AsyncIterator[Any]:
    """Streaming ``litellm.acompletion`` with transport-only retry + stall watchdog.

    Transient transport failures while opening/first-token are retried with
    backoff. A slow first token (no error, just slow) is bounded by
    ``tier.timeout_s`` and aborts with :class:`LLMStreamStalled` — it is never
    retried, so a healthy-but-slow generation is not re-run. After the first
    chunk, each subsequent chunk must arrive within ``stall_timeout_s`` (defaults
    to ``tier.stall_timeout_s``) or the stream aborts — no mid-stream retry.
    """
    if stall_timeout_s is None:
        stall_timeout_s = tier.stall_timeout_s

    async def _open_and_first() -> tuple[Any, Any, Any, bool]:
        stream = await litellm.acompletion(
            stream=True,
            timeout=tier.timeout_s,
            num_retries=0,
            **kwargs,
        )
        aiter = stream.__aiter__()
        try:
            first = await asyncio.wait_for(aiter.__anext__(), timeout=tier.timeout_s)
        except StopAsyncIteration:
            # Empty but successful; the caller's finally closes the stream.
            return stream, aiter, None, True
        except asyncio.TimeoutError as exc:
            # Slow first token = the model thinking, not a transport failure.
            # LLMStreamStalled is not transient, so the retryer re-raises it
            # instead of re-opening (which would re-run the generation).
            await _aclose_quietly(stream)
            raise LLMStreamStalled(
                f"LLM produced no first token within {tier.timeout_s}s"
            ) from exc
        except BaseException:
            # A transient transport error here is retried (the retryer re-opens),
            # so close this stream first or it leaks once per retry. Other
            # failures / cancellation close it on the way out too.
            await _aclose_quietly(stream)
            raise
        return stream, aiter, first, False

    stream, aiter, first, empty = cast(
        "tuple[Any, Any, Any, bool]",
        await _async_retryer(tier)(_open_and_first),
    )

    # Own the stream from here: every exit path (empty, normal end, stall, or an
    # abandoned generator on client disconnect) must release the HTTP connection.
    try:
        if empty:
            return

        yield first
        while True:
            try:
                chunk = await asyncio.wait_for(
                    aiter.__anext__(), timeout=stall_timeout_s
                )
            except StopAsyncIteration:
                break
            except asyncio.TimeoutError as exc:
                raise LLMStreamStalled(
                    f"LLM stream stalled: no chunk within {stall_timeout_s}s"
                ) from exc
            yield chunk
    finally:
        await _aclose_quietly(stream)
