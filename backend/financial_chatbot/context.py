"""Context and evidence helpers for the finance chatbot."""

from __future__ import annotations

import json
import re
from urllib.parse import urlparse

from .calculator import build_modeled_complication_catalog
from .config import (
    BROAD_COMPLICATION_PATTERNS,
    CONSULTANT_SYNTHESIS_PROMPT,
    MODELED_COMPLICATION_ALIASES,
)
from .schemas import ChatMessage, FinancePresentationInput, FinanceStateSnapshot


def build_agent_context(
    *,
    message: str,
    history: list[ChatMessage],
    finance_state: FinanceStateSnapshot,
    answer_safe_context: str | None,
    presentation: FinancePresentationInput | None = None,
    complication_context: str | None = None,
) -> str:
    parts = [f"Latest user message:\n<user_message>\n{message}\n</user_message>"]

    if history:
        parts.append("")
        parts.append("Recent conversation:")
        for turn in history[-8:]:
            parts.append(
                f"- {turn.role}: <conversation_turn>{turn.content}</conversation_turn>"
            )

    parts.extend(("", "Known finance state:", finance_state.model_dump_json()))

    if presentation is not None:
        parts.extend(
            ("", "Finance presentation payload:", presentation.model_dump_json())
        )

    if complication_context is not None:
        parts.extend(("", "Modeled complication catalog:", complication_context))

    if answer_safe_context:
        parts.extend(("", "Saved project context:", answer_safe_context[:1800]))

    return "\n".join(parts)


def build_follow_up_context(
    *,
    message: str,
    answer: str,
    route: str,
    history: list[ChatMessage],
    finance_state: FinanceStateSnapshot,
    presentation: FinancePresentationInput,
) -> str:
    base_context = build_agent_context(
        message=message,
        history=history,
        finance_state=finance_state,
        answer_safe_context=None,
        presentation=presentation,
    )
    return f"{base_context}\n\nRoute:\n{route}\n\nAnswer:\n{answer}"


def build_consultant_complication_context(
    *,
    finance_state: FinanceStateSnapshot,
    message: str,
) -> str:
    catalog = build_modeled_complication_catalog(finance_state)
    modeled_keys = identify_modeled_complications_in_message(message, catalog)
    payload = {
        "broad_complication_request": is_broad_complication_request(message),
        "mentioned_modeled_complication_keys": modeled_keys,
        "currently_included_modeled_complications": [
            entry for entry in catalog if entry["is_currently_included"]
        ],
        "modeled_but_not_currently_included_complications": [
            entry for entry in catalog if not entry["is_currently_included"]
        ],
    }
    return json.dumps(payload, separators=(",", ":"))


def identify_modeled_complications_in_message(
    message: str,
    catalog: list[dict],
) -> list[str]:
    normalized_message = normalize_lookup_text(message)
    mentioned_keys: list[str] = []
    for entry in catalog:
        complication_key = entry["key"]
        for alias in get_complication_aliases(complication_key, entry["label"]):
            if alias in normalized_message:
                mentioned_keys.append(complication_key)
                break
    return mentioned_keys


def get_complication_aliases(complication_key: str, label: str) -> tuple[str, ...]:
    normalized_label = normalize_lookup_text(label)
    normalized_key = normalize_lookup_text(complication_key.replace("_", " "))
    aliases = {normalized_label, normalized_key}
    aliases.update(MODELED_COMPLICATION_ALIASES.get(complication_key, ()))
    return tuple(normalize_lookup_text(alias) for alias in aliases)


def normalize_lookup_text(value: str) -> str:
    collapsed = re.sub(r"[^a-z0-9]+", " ", value.lower())
    return f" {collapsed.strip()} "


def is_broad_complication_request(message: str) -> bool:
    normalized_message = normalize_lookup_text(message)
    return any(pattern in normalized_message for pattern in BROAD_COMPLICATION_PATTERNS)


def build_consultant_synthesis_instructions(
    *,
    sources: list[dict],
    research_summary: str,
) -> str:
    instructions = CONSULTANT_SYNTHESIS_PROMPT

    if research_summary:
        instructions += f"\n\nInternal research memo:\n{research_summary[:1800]}"

    evidence_context = build_consultant_evidence_context(sources)
    if not sources:
        instructions += (
            "\n\nNo evidence sources were gathered. Do not use citations. "
            "Explain that the available web evidence was insufficient to support a clear answer."
        )
        return instructions

    instructions += (
        f"\n\nCITATION CONSTRAINT: You have exactly {len(sources)} source document(s) "
        f"labeled [1] through [{len(sources)}]. "
        "Never write a citation number outside this range. "
        "Only cite a source number when that exact numbered source directly supports the immediately preceding claim. "
        "If a claim cannot be matched to one of these numbered sources with confidence, leave it uncited. "
        "Never cite internal/local context, payloads, calculator data, or research memos. "
        "Never output non-numeric bracket labels as citations."
        "\n\nEvidence sources:\n"
        f"{evidence_context}"
    )
    return instructions


def build_consultant_evidence_context(sources: list[dict]) -> str:
    labeled_sources: list[str] = []
    for index, source in enumerate(sources, start=1):
        lines = [f"[{index}] Title: {source.get('source') or 'Untitled result'}"]
        publisher = source.get("publisher")
        if publisher:
            lines.append(f"Publisher: {publisher}")

        url = source.get("url")
        if url:
            lines.append(f"URL: {url}")

        snippet = (source.get("chunk_text") or "").strip()
        if snippet:
            lines.append(f"Evidence: {snippet}")

        labeled_sources.append("\n".join(lines))

    return "\n---\n".join(labeled_sources)


def normalize_web_search_source(result: dict) -> dict:
    url = result.get("url")
    title = (result.get("title") or "").strip()
    publisher = extract_publisher(url)
    source_name = title or publisher or "Untitled result"
    content = (result.get("content") or "").strip()
    return {
        "page_number": None,
        "source": source_name,
        "regulation_topic": "finance",
        "chunk_text": content[:600],
        "url": url,
        "publisher": publisher,
    }


def append_unique_source(collected_sources: list[dict], candidate_source: dict) -> None:
    candidate_key = build_source_key(candidate_source)
    if any(build_source_key(source) == candidate_key for source in collected_sources):
        return
    collected_sources.append(candidate_source)


def build_source_key(source: dict) -> str:
    url = source.get("url")
    if url:
        return str(url)
    title = str(source.get("source") or "")
    snippet = str(source.get("chunk_text") or "")[:120]
    return f"{title}:{snippet}"


def extract_publisher(url: str | None) -> str | None:
    if not url:
        return None
    parsed = urlparse(url)
    hostname = parsed.netloc.lower()
    if not hostname:
        return None
    if hostname.startswith("www."):
        hostname = hostname[4:]
    return hostname
