"""
Phase 6 — Consolidator Agent (Delta Update Pipeline).

After each meaningful exchange, the Consolidator analyses the latest
conversation turns against the current report state and identifies which
report section(s) have new information. It then runs a targeted LLM prompt
to regenerate *only* the affected sections and merges them back via
`ReportRepository.delta_update()`.

This is the "fill new information into the same report" feedback arrow
from the architecture diagram (Report_Architecture.md §2.5).
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any, cast

from api.llm import LONG, build_chat_llm
from api.rate_limiting.llm_pricing import (
    CHAT_COMPLETION_MODEL as CONSOLIDATOR_MODEL,
)
from api.rate_limiting.llm_usage import record_langchain_usage
from api.report_sanitizer import (
    sanitize_report_context_fields,
    sanitize_report_text,
    sanitize_report_visible_fields,
)
from langchain_core.messages import HumanMessage, SystemMessage

logger = logging.getLogger(__name__)


def _message_text(content: str | list[str | dict[Any, Any]] | None) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(part if isinstance(part, str) else str(part) for part in content)
    return ""


def _record_consolidator_usage(raw_message: Any, *, source: str) -> None:
    record_langchain_usage(
        raw_message=raw_message,
        route="consolidator",
        source=source,
        model=CONSOLIDATOR_MODEL,
    )


# Visible report sections that the consolidator can target
_VISIBLE_SECTIONS = [
    "executive_summary",
    "property_overview",
    "zoning_analysis",
    "financial_snapshot",
    "recommendations",
]

# Context report sections
_CONTEXT_SECTIONS = [
    "key_questions",
    "implicit_preferences",
    "notable_signals",
]

# ── System prompts ────────────────────────────────────────────────────────────

_ANALYSIS_PROMPT = """\
You are a report-maintenance analyst for an ADU (Accessory Dwelling Unit) advisory system.

Given the CURRENT REPORT STATE and RECENT CONVERSATION EXCHANGE below, determine
which report sections (if any) contain information that should be updated based
on the new conversation.

The report has two layers:

**Visible sections** (shown to user):
- executive_summary
- property_overview
- zoning_analysis
- financial_snapshot
- recommendations

**Context sections** (hidden, used by AI):
- key_questions
- implicit_preferences
- notable_signals

Respond with a JSON object — no markdown fences, no extra text:
{"should_update":true/false,"affected_sections":["section_name",...],"reasoning":"one sentence explaining why"}

Rules:
- Set should_update to false if the exchange is casual, off-topic, or does not
  add meaningful new information to the report.
- Only list sections that genuinely have new data to incorporate.
- Prefer fewer sections — only flag sections where the conversation clearly
  provides new or corrected information.
- Context sections (key_questions, implicit_preferences, notable_signals)
  should almost always be updated when should_update is true.
"""

_DELTA_PROMPT = """\
You are a report updater for an ADU (Accessory Dwelling Unit) advisory system.

You are given:
1. The CURRENT content of specific report sections
2. A RECENT CONVERSATION EXCHANGE that contains new information

Your job: produce updated content for ONLY the listed sections, incorporating
the new information from the conversation. Preserve existing information that
is still accurate — this is a MERGE, not a replacement.

Respond with a JSON object — no markdown fences, no extra text. The shape must
match exactly the sections requested:

{"visible":{"section_name":"updated Markdown content",...},"context":{"section_name":["updated","list","items"],...}}

Rules:
- Only include sections that were requested. Do NOT add extra sections.
- Visible sections must contain well-formatted Markdown.
- CRITICAL: Do NOT include section heading lines (e.g. "## Financial Snapshot",
  "## Recommendations") inside field values. The frontend adds those headings
  automatically — including them in the value causes duplicate headers in the UI.
  Write ONLY the body content (bullet points, tables, paragraphs) for each section.
- Context list items should be concise strings. Place most recent signals first.
- Keep the entire context section under 2,000 tokens.
- Do NOT invent data — only use information from the conversation or existing report.
- Do NOT use inline citations like `[1]`, `[11]`, `[1][2]`, or markdown footnotes like `[^1]`.
- Do NOT add footnote definition lines, source lists, or bibliography text.
- Do NOT wrap your response in markdown code fences. Output raw JSON only.
"""


# ── Core logic ────────────────────────────────────────────────────────────────


async def analyse_exchange(
    report_visible: dict[str, Any],
    report_context: dict[str, Any],
    user_message: str,
    assistant_reply: str,
) -> dict[str, Any]:
    """
    Step 1: Ask the LLM whether this exchange warrants a report update,
    and if so, which sections are affected.

    Returns the parsed JSON with `should_update`, `affected_sections`, `reasoning`.
    """
    api_key = os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        return {
            "should_update": False,
            "affected_sections": [],
            "reasoning": "No API key",
        }

    # Build a compact summary of current report state
    report_summary_parts: list[str] = ["CURRENT REPORT STATE:"]
    for section in _VISIBLE_SECTIONS:
        val = report_visible.get(section, "")
        if val:
            sanitized_value = sanitize_report_text(val)
            # Truncate long sections for the analysis prompt
            preview = (
                sanitized_value[:300] + "…"
                if len(sanitized_value) > 300
                else sanitized_value
            )
            report_summary_parts.append(f"[visible.{section}]: {preview}")
    for section in _CONTEXT_SECTIONS:
        val = report_context.get(section, [])
        if val:
            sanitized_value = sanitize_report_text(json.dumps(val))
            report_summary_parts.append(f"[context.{section}]: {sanitized_value}")

    report_summary = "\n".join(report_summary_parts)

    exchange = (
        f"RECENT CONVERSATION EXCHANGE:\n"
        f"User: {user_message}\n"
        f"Assistant: {sanitize_report_text(assistant_reply)}"
    )

    llm = build_chat_llm(tier=LONG, api_key=api_key, temperature=None)
    messages = [
        SystemMessage(content=_ANALYSIS_PROMPT),
        HumanMessage(content=f"{report_summary}\n\n{exchange}"),
    ]

    result = await llm.ainvoke(messages)
    _record_consolidator_usage(
        result,
        source="orchestrator.consolidator.analyse_exchange",
    )
    raw = _message_text(result.content).strip()

    # Strip markdown fences if LLM ignores instructions
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
        if raw.endswith("```"):
            raw = raw[:-3]
        raw = raw.strip()

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        logger.warning(f"Consolidator analysis returned invalid JSON: {raw[:200]}")
        return {
            "should_update": False,
            "affected_sections": [],
            "reasoning": "Parse error",
        }


async def generate_delta(
    report_visible: dict[str, Any],
    report_context: dict[str, Any],
    affected_sections: list[str],
    user_message: str,
    assistant_reply: str,
) -> dict[str, Any] | None:
    """
    Step 2: Given the affected sections, run a targeted prompt to regenerate
    only those sections and return a delta dict suitable for `ReportUpdate`.
    """
    api_key = os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        return None

    # Build current content for only the affected sections
    current_parts: list[str] = ["CURRENT SECTION CONTENT (update these):"]

    visible_sections = [s for s in affected_sections if s in _VISIBLE_SECTIONS]
    context_sections = [s for s in affected_sections if s in _CONTEXT_SECTIONS]

    for section in visible_sections:
        val = report_visible.get(section, "")
        current_parts.append(f"[visible.{section}]:\n{sanitize_report_text(val)}")

    for section in context_sections:
        val = report_context.get(section, [])
        sanitized_value = sanitize_report_text(json.dumps(val))
        current_parts.append(f"[context.{section}]: {sanitized_value}")

    current_content = "\n\n".join(current_parts)

    exchange = (
        f"RECENT CONVERSATION EXCHANGE:\n"
        f"User: {user_message}\n"
        f"Assistant: {sanitize_report_text(assistant_reply)}"
    )

    sections_requested = (
        f"SECTIONS TO UPDATE: {', '.join(affected_sections)}\n"
        f"(visible sections: {visible_sections}, context sections: {context_sections})"
    )

    llm = build_chat_llm(tier=LONG, api_key=api_key, temperature=None)
    messages = [
        SystemMessage(content=_DELTA_PROMPT),
        HumanMessage(
            content=f"{sections_requested}\n\n{current_content}\n\n{exchange}"
        ),
    ]

    result = await llm.ainvoke(messages)
    _record_consolidator_usage(
        result,
        source="orchestrator.consolidator.generate_delta",
    )
    raw = _message_text(result.content).strip()

    # Strip markdown fences
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
        if raw.endswith("```"):
            raw = raw[:-3]
        raw = raw.strip()

    try:
        delta = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning(f"Consolidator delta returned invalid JSON: {raw[:200]}")
        return None

    # Validate: only keep sections that were actually requested
    clean: dict[str, Any] = {}
    if "visible" in delta:
        visible_delta = {
            k: v for k, v in delta["visible"].items() if k in visible_sections
        }
        clean["visible"] = sanitize_report_visible_fields(visible_delta)
    if "context" in delta:
        context_delta = {
            k: v for k, v in delta["context"].items() if k in context_sections
        }
        clean["context"] = sanitize_report_context_fields(context_delta)

    return clean if (clean.get("visible") or clean.get("context")) else None


async def consolidate(
    project_id: str,
    user_id: str | None,
    user_message: str,
    assistant_reply: str,
) -> bool:
    """
    Full consolidation pipeline: analyse → delta → merge.

    Returns True if the report was updated, False otherwise.
    """
    # ponytail: intentionally unwired since refactor 4ace67c removed the
    # post-stream trigger. Kept for re-enabling report auto-sync — re-wire with
    # asyncio.create_task(consolidate(...)) at orchestrator/router.py:~333.
    # Delete this whole module if that feature is confirmed abandoned.
    from api.database.core import SessionLocal
    from api.database.repository import ReportRepository
    from api.database.schemas import ReportUpdate

    if not user_id:
        return False

    with SessionLocal() as db:
        report = ReportRepository.get_report_by_project(
            db,
            project_id,
            user_id=user_id,
        )
        if not report:
            logger.debug(
                f"No report for project {project_id[:8]}…, skipping consolidation"
            )
            return False

        report_visible = dict(cast(Any, report.visible) or {})
        report_context = dict(cast(Any, report.context) or {})
        current_version = cast(int | None, report.version)

    # Step 1: Analyse
    analysis = await analyse_exchange(
        report_visible, report_context, user_message, assistant_reply
    )

    if not analysis.get("should_update", False):
        logger.info(
            f"Consolidator: no update needed for project {project_id[:8]}… "
            f"— {analysis.get('reasoning', 'n/a')}"
        )
        return False

    affected = analysis.get("affected_sections", [])
    logger.info(
        f"Consolidator: updating sections {affected} for project {project_id[:8]}… "
        f"— {analysis.get('reasoning', 'n/a')}"
    )

    # Step 2: Generate delta
    delta = await generate_delta(
        report_visible, report_context, affected, user_message, assistant_reply
    )

    if not delta:
        logger.warning("Consolidator: delta generation returned nothing")
        return False

    # Step 3: Merge via repository (with optimistic concurrency)
    with SessionLocal() as db:
        try:
            updated_report = ReportRepository.delta_update(
                db,
                project_id,
                ReportUpdate(
                    visible=delta.get("visible"),
                    context=delta.get("context"),
                ),
                expected_version=current_version,
                user_id=user_id,
            )
            logger.info(
                f"Consolidator: report updated to v{updated_report.version} "
                f"for project {project_id[:8]}…"
            )
            return True
        except Exception as exc:
            logger.warning(f"Consolidator: delta merge failed: {exc}")
            return False
