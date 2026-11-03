"""Shared LLM resilience layer.

Centralizes timeout + exponential-backoff retries for every way the backend
reaches an LLM:

- LangChain ``ChatOpenAI`` (pointed at OpenRouter) via :func:`api.llm.factory.build_chat_llm`
- LiteLLM ``acompletion`` via :func:`api.llm.litellm_client.acompletion_resilient`
  and :func:`api.llm.litellm_client.astream_resilient`
- raw ``google.genai`` via :func:`api.llm.genai_client.build_genai_client`

Configuration lives in :mod:`api.llm.tiers` (``FAST`` / ``STANDARD`` / ``LONG``).
"""

from __future__ import annotations

from .factory import build_chat_llm
from .genai_client import build_genai_client, genai_http_options
from .litellm_client import (
    LLMStreamStalled,
    acompletion_resilient,
    astream_resilient,
)
from .tiers import FAST, LONG, STANDARD, LLMTier

__all__ = [
    "LLMTier",
    "FAST",
    "STANDARD",
    "LONG",
    "build_chat_llm",
    "build_genai_client",
    "genai_http_options",
    "acompletion_resilient",
    "astream_resilient",
    "LLMStreamStalled",
]
