"""Helpers for keeping persisted reports free of chat-style citations."""

from __future__ import annotations

import re
from typing import Any

FOOTNOTE_DEFINITION_RE = re.compile(
    r"(?m)^\[\^[^\]]+\]:[^\n]*(?:\n(?:[ \t]{2,}.*|\t.*))*\n?"
)
FOOTNOTE_REFERENCE_RE = re.compile(r"\[\^[^\]]+\]")
COMMA_SEPARATED_CITATION_RE = re.compile(r"\[(?:\d+(?:,\s+\d+)+)\]")
SINGLE_CITATION_RE = re.compile(r"\[\d+\]")
SPACES_BEFORE_PUNCTUATION_RE = re.compile(r"[ \t]+([,.;:!?])")
EXTRA_INLINE_SPACES_RE = re.compile(r"(?<=\S) {2,}(?=\S)")
EMPTY_BULLET_RE = re.compile(r"^[-*+]\s*$")
HTML_LIST_ITEM_RE = re.compile(r"(?is)<li>\s*(.*?)\s*</li>")
HTML_LIST_CONTAINER_RE = re.compile(r"(?is)</?(?:ul|ol)>")
HTML_PARAGRAPH_BREAK_RE = re.compile(r"(?is)</p>\s*<p>")
HTML_PARAGRAPH_TAG_RE = re.compile(r"(?is)</?p>")
INLINE_NUMBERED_LIST_RE = re.compile(r"(?<![\n\d,])(\d{1,2})\.\s+")


def sanitize_report_text(text: str) -> str:
    if not text:
        return text

    sanitized_text = FOOTNOTE_DEFINITION_RE.sub("", text)
    sanitized_text = FOOTNOTE_REFERENCE_RE.sub("", sanitized_text)
    sanitized_text = COMMA_SEPARATED_CITATION_RE.sub("", sanitized_text)
    sanitized_text = SINGLE_CITATION_RE.sub("", sanitized_text)
    sanitized_text = normalize_report_markup(sanitized_text)
    return normalize_report_whitespace(sanitized_text)


def normalize_report_markup(text: str) -> str:
    normalized_text = normalize_html_list_markup(text)
    return normalize_inline_numbered_lists(normalized_text)


def normalize_html_list_markup(text: str) -> str:
    normalized_text = HTML_PARAGRAPH_BREAK_RE.sub("\n\n", text)
    normalized_text = HTML_LIST_ITEM_RE.sub(
        lambda match: f"- {collapse_inline_whitespace(match.group(1))}\n",
        normalized_text,
    )
    normalized_text = HTML_LIST_CONTAINER_RE.sub("\n", normalized_text)
    return HTML_PARAGRAPH_TAG_RE.sub("", normalized_text)


def normalize_inline_numbered_lists(text: str) -> str:
    matches = list(INLINE_NUMBERED_LIST_RE.finditer(text))
    if not is_jammed_numbered_list(matches):
        return text

    intro = text[: matches[0].start()].strip()
    bullet_lines: list[str] = []
    for index, match in enumerate(matches):
        item_start = match.end()
        item_end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        item_text = collapse_inline_whitespace(text[item_start:item_end])
        if item_text:
            bullet_lines.append(f"- {item_text}")

    if not bullet_lines:
        return text

    sections = [intro] if intro else []
    sections.extend(bullet_lines)
    return "\n".join(sections)


def is_jammed_numbered_list(matches: list[re.Match[str]]) -> bool:
    if len(matches) < 2:
        return False
    for expected_index, match in enumerate(matches, start=1):
        if int(match.group(1)) != expected_index:
            return False
    return True


def collapse_inline_whitespace(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def normalize_report_whitespace(text: str) -> str:
    normalized_lines: list[str] = []
    for line in text.splitlines():
        normalized_line = SPACES_BEFORE_PUNCTUATION_RE.sub(r"\1", line)
        normalized_line = EXTRA_INLINE_SPACES_RE.sub(" ", normalized_line).rstrip()
        if EMPTY_BULLET_RE.match(normalized_line.strip()):
            continue
        normalized_lines.append(normalized_line)

    normalized_text = "\n".join(normalized_lines).strip()
    return re.sub(r"\n{3,}", "\n\n", normalized_text)


def sanitize_report_visible_fields(
    visible_fields: dict[str, Any] | None,
) -> dict[str, Any] | None:
    return sanitize_report_field_map(visible_fields)


def sanitize_report_context_fields(
    context_fields: dict[str, Any] | None,
) -> dict[str, Any] | None:
    return sanitize_report_field_map(context_fields)


def sanitize_report_field_map(
    field_map: dict[str, Any] | None,
) -> dict[str, Any] | None:
    if field_map is None:
        return None
    return {key: sanitize_report_value(value) for key, value in field_map.items()}


def sanitize_report_value(value: Any) -> Any:
    if isinstance(value, str):
        return sanitize_report_text(value)
    if isinstance(value, list):
        return [sanitize_report_value(item) for item in value]
    if isinstance(value, dict):
        return {key: sanitize_report_value(item) for key, item in value.items()}
    return value
