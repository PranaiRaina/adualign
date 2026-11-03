"""
LLM-based entity extraction for ADU document chunks.

Calls deepseek-v4-flash (OpenRouter) to extract structured metadata from each
chunk. Metadata is stored as columns on the Supabase pgvector handbook_chunks
table for pre-filtering. Runs in a worker thread (asyncio.to_thread) during
ingestion, so the synchronous ``litellm.completion`` is fine here.
"""

from __future__ import annotations

import json
import logging

import litellm

from api.llm import LONG
from RAG_pipeline.schemas import _EXTRACTION_PROMPT, _SUMMARY_PROMPT
from api.rate_limiting.llm_pricing import (
    LITELLM_CHAT_MODEL,
    REASONING_MINIMAL,
    reasoning_kwargs,
)
from api.utils import get_openrouter_key, minify_llm_response

logger = logging.getLogger(__name__)

METADATA_FIELDS = [
    "zoning_code",
    "city",
    "lot_size_range",
    "adu_type",
    "regulation_topic",
    "is_structural",
]


def _chat_complete(prompt: str, api_key: str, *, json_mode: bool) -> str:
    """One synchronous chat completion against deepseek-v4-flash on OpenRouter."""
    kwargs: dict = dict(
        model=LITELLM_CHAT_MODEL,
        api_key=api_key,
        messages=[{"role": "user", "content": prompt}],
        timeout=LONG.timeout_s,
        num_retries=LONG.retries,
        **reasoning_kwargs(REASONING_MINIMAL),
    )
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}
    response = litellm.completion(**kwargs)
    return (response.choices[0].message.content or "").strip()


def extract_metadata(chunk_text: str) -> dict:
    """
    Extract structured metadata from a text chunk using deepseek-v4-flash.

    Returns a flat dict safe for handbook_chunks metadata storage.
    Falls back to defaults on any failure.
    """
    defaults = {
        "zoning_code": "",
        "city": "",
        "lot_size_range": "",
        "adu_type": "",
        "regulation_topic": "general",
        "is_structural": False,
    }

    api_key = get_openrouter_key()
    if not api_key:
        logger.warning("OPENROUTER_API_KEY not set — skipping metadata extraction")
        return defaults

    try:
        prompt = _EXTRACTION_PROMPT.format(chunk_text=chunk_text[:3000])
        raw_text = _chat_complete(prompt, api_key, json_mode=True)
        minified_json = minify_llm_response(raw_text)

        # Debugging: Write raw text to a temp file if it looks broken
        if not minified_json.startswith("{"):
            logger.warning("LLM returned non-JSON text: %s", minified_json[:100])

        try:
            parsed = json.loads(minified_json)
        except Exception as e:
            logger.warning("JSON load failed: %s | Text: %s", e, minified_json[:200])
            return defaults

        # Normalize: handbook_chunks metadata values must be str, int, float, or bool.
        result = {}
        if isinstance(parsed, list) and len(parsed) > 0 and isinstance(parsed[0], dict):
            parsed = parsed[0]

        if isinstance(parsed, dict):
            for field in METADATA_FIELDS:
                val = parsed.get(field)
                if field == "is_structural":
                    result[field] = str(bool(val))
                else:
                    result[field] = str(val) if val is not None else ""
        else:
            logger.warning("Parsed JSON is not a dict: %s", type(parsed))
            return defaults

        return result

    except Exception as exc:
        logger.warning("Metadata extraction failed: %s | Type: %s", exc, type(exc))
        return defaults


def generate_summary(chunk_text: str) -> str:
    """
    Generate a one-sentence summary prefix for a chunk to improve embedding quality.

    Falls back to first 150 chars if LLM call fails.
    """
    api_key = get_openrouter_key()
    if not api_key:
        return chunk_text[:150]

    try:
        prompt = _SUMMARY_PROMPT.format(chunk_text=chunk_text[:2000])
        summary = _chat_complete(prompt, api_key, json_mode=False)
        return summary[:200]

    except Exception as exc:
        logger.warning("Summary generation failed: %s", exc)
        return chunk_text[:150]
