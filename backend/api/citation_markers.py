"""Helpers for keeping user-facing citation markers source-backed."""

from __future__ import annotations

import re

NUMERIC_CITATION_MARKER_RE = re.compile(r"\[(\d+(?:\s*,\s*\d+)*)\]")
NON_NUMERIC_BRACKET_MARKER_RE = re.compile(
    r"\[(?!\d+(?:\s*,\s*\d+)*\])([^\]\n]{1,120})\](?!\()"
)
SPACES_BEFORE_PUNCTUATION_RE = re.compile(r"[ \t]+([,.;:!?])")
EXTRA_INLINE_SPACES_RE = re.compile(r"(?<=\S) {2,}(?=\S)")
TRAILING_WHITESPACE_RE = re.compile(r"\s+$")


def strip_non_numeric_citation_markers(text: str) -> str:
    """Remove bracketed labels that cannot point to numbered evidence sources."""
    stripped_text = NON_NUMERIC_BRACKET_MARKER_RE.sub("", text)
    stripped_text = SPACES_BEFORE_PUNCTUATION_RE.sub(r"\1", stripped_text)
    return EXTRA_INLINE_SPACES_RE.sub(" ", stripped_text)


def split_complete_bracket_text(text: str) -> tuple[str, str]:
    last_open_bracket = text.rfind("[")
    last_close_bracket = text.rfind("]")
    if last_open_bracket > last_close_bracket:
        return text[:last_open_bracket], text[last_open_bracket:]
    return text, ""


class StreamingNonNumericCitationStripper:
    """Strip non-numeric bracket markers without leaking split stream fragments."""

    def __init__(self) -> None:
        self.pending_text = ""
        self.pending_prefix = ""

    def consume(self, chunk: str) -> str:
        if not chunk:
            return ""
        self.pending_text += chunk
        complete_text, self.pending_text = split_complete_bracket_text(
            self.pending_text
        )
        held_prefix = ""
        if self.pending_text:
            trailing_whitespace_match = TRAILING_WHITESPACE_RE.search(complete_text)
            if trailing_whitespace_match is not None:
                held_prefix = trailing_whitespace_match.group(0)
                complete_text = complete_text[: -len(held_prefix)]

        flush_text = f"{self.pending_prefix}{complete_text}"
        self.pending_prefix = held_prefix
        return strip_non_numeric_citation_markers(flush_text)

    def finalize(self) -> str:
        final_text = self.pending_text
        self.pending_text = ""
        flush_text = f"{self.pending_prefix}{final_text}"
        self.pending_prefix = ""
        return strip_non_numeric_citation_markers(flush_text)
