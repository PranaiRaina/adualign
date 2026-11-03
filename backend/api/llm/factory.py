"""LangChain ``ChatOpenAI`` factory (pointed at OpenRouter) with timeout + retries baked in."""

from __future__ import annotations

from typing import Any

from langchain_openai import ChatOpenAI

from api.rate_limiting.llm_pricing import (
    DEFAULT_REASONING_LEVEL,
    OPENROUTER_BASE_URL,
    OPENROUTER_CHAT_MODEL,
    openrouter_extra_body,
)
from api.utils import get_openrouter_key

from .tiers import LLMTier


def build_chat_llm(
    *,
    tier: LLMTier,
    model: str = OPENROUTER_CHAT_MODEL,
    api_key: str | None = None,
    temperature: float | None = 0.0,
    max_output_tokens: int | None = None,
    structured_output: type | None = None,
    include_raw: bool = False,
    reasoning_level: str = DEFAULT_REASONING_LEVEL,
):
    """Build a configured chat model for the given resilience ``tier``.

    Targets deepseek-v4-flash on OpenRouter via its OpenAI-compatible endpoint.
    Sets the request ``timeout`` and ``max_retries`` from the tier (``ChatOpenAI``
    ``max_retries`` is *additional* attempts, so we pass ``tier.retries``).

    Reasoning + provider routing are passed through ``extra_body`` (so they land
    in the request body and avoid the ``model_kwargs`` collision newer
    langchain-openai raises for known fields) via :func:`openrouter_extra_body`.
    ``reasoning_level`` defaults to medium; non-final RAG/finance nodes pass minimal.

    When ``structured_output`` is given, returns ``.with_structured_output`` using
    ``method="json_schema"`` (OpenRouter/deepseek supports ``response_format``
    json_schema; provider routing keeps it on backends that actually enforce it).

    ``temperature=None`` omits the parameter so the SDK default is used.
    """
    if api_key is None:
        api_key = get_openrouter_key()
    if not api_key:
        raise RuntimeError("OPENROUTER_API_KEY is required to build a chat LLM.")

    kwargs: dict[str, Any] = dict(
        model=model,
        api_key=api_key,
        base_url=OPENROUTER_BASE_URL,
        timeout=tier.timeout_s,
        max_retries=tier.retries,
        extra_body=openrouter_extra_body(reasoning_level),
    )
    if temperature is not None:
        kwargs["temperature"] = temperature
    if max_output_tokens is not None:
        kwargs["max_tokens"] = max_output_tokens

    llm = ChatOpenAI(**kwargs)
    if structured_output is not None:
        return llm.with_structured_output(
            structured_output, method="json_schema", include_raw=include_raw
        )
    return llm
