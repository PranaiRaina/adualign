"""Timeout / retry tiers shared across every LLM call path.

``retries`` counts retries *beyond* the first attempt, so the total number of
attempts is ``retries + 1``. Each SDK adapter translates that into its own
"attempts" convention (LangChain ``max_retries``, genai ``HttpRetryOptions.attempts``,
tenacity ``stop_after_attempt``).
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class LLMTier:
    """A resilience preset: how long to wait and how many times to retry.

    ``timeout_s`` bounds connection/open and the wait for the first streamed
    token (a slow first token is the model thinking, not a failure).
    ``stall_timeout_s`` bounds the gap *between* chunks once streaming has
    started — tighter than ``timeout_s`` because a mid-stream gap is more
    suspicious than slow thinking up front.
    """

    name: str
    timeout_s: float
    retries: int
    stall_timeout_s: float


# A fast, user-facing classification/routing call should fail fast and retry
# aggressively; a long report generation should be patient and retry sparingly.
FAST = LLMTier(name="fast", timeout_s=15.0, retries=3, stall_timeout_s=15.0)
STANDARD = LLMTier(name="standard", timeout_s=45.0, retries=2, stall_timeout_s=30.0)
LONG = LLMTier(name="long", timeout_s=180.0, retries=1, stall_timeout_s=60.0)

# Shared exponential-backoff-with-jitter settings (used by every SDK adapter).
BACKOFF_INITIAL_S = 1.0
BACKOFF_EXP_BASE = 2.0
BACKOFF_MAX_S = 10.0
BACKOFF_JITTER_S = 1.0

# HTTP status codes that warrant a retry (transient failures). Single source of
# truth for retryability across all three SDK paths (LiteLLM, LangChain, genai).
RETRYABLE_STATUS_CODES = (408, 429, 500, 502, 503, 504)
