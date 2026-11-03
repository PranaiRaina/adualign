"""Raw ``google.genai`` client builder with timeout + retries.

Reuses the *same* native ``HttpRetryOptions`` mechanism as the LangChain path
(exponential backoff with jitter), so the background ingestion calls get the
same resilience as the request-path calls.
"""

from __future__ import annotations

from google import genai
from google.genai import types

from .tiers import (
    BACKOFF_EXP_BASE,
    BACKOFF_INITIAL_S,
    BACKOFF_JITTER_S,
    BACKOFF_MAX_S,
    RETRYABLE_STATUS_CODES,
    LLMTier,
)


def genai_http_options(tier: LLMTier) -> types.HttpOptions:
    """Build ``HttpOptions`` carrying the tier's timeout + exponential retry."""
    return types.HttpOptions(
        timeout=int(tier.timeout_s * 1000),  # genai expects milliseconds
        retry_options=types.HttpRetryOptions(
            attempts=tier.retries + 1,
            initial_delay=BACKOFF_INITIAL_S,
            max_delay=BACKOFF_MAX_S,
            exp_base=BACKOFF_EXP_BASE,
            jitter=BACKOFF_JITTER_S,
            http_status_codes=list(RETRYABLE_STATUS_CODES),
        ),
    )


def build_genai_client(*, tier: LLMTier, api_key: str) -> genai.Client:
    """Build a ``google.genai`` client with timeout + retries for ``tier``."""
    return genai.Client(api_key=api_key, http_options=genai_http_options(tier))
