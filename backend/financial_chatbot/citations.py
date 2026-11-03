"""Utilities for canonicalizing finance-chat citations."""

from __future__ import annotations

import re
from typing import Any

from api.citation_markers import (
    NUMERIC_CITATION_MARKER_RE,
    split_complete_bracket_text,
    strip_non_numeric_citation_markers,
)

CITATION_MARKER_RE = NUMERIC_CITATION_MARKER_RE
SPACES_BEFORE_PUNCTUATION_RE = re.compile(r"[ \t]+([,.;:!?])")
EXTRA_INLINE_SPACES_RE = re.compile(r"(?<=\S) {2,}(?=\S)")
TRAILING_WHITESPACE_RE = re.compile(r"\s+$")


def normalize_finance_chat_citations(
    answer: str,
    sources: list[dict[str, Any]],
) -> tuple[str, list[dict[str, Any]]]:
    if not answer:
        return answer, []
    if not sources:
        return cleanup_citation_spacing(
            strip_all_citation_markers(strip_non_numeric_citation_markers(answer))
        ), []

    citation_map = CitationMap(total_sources=len(sources))
    normalized_answer = rewrite_citation_markers(answer, citation_map)
    normalized_sources = citation_map.build_ordered_sources(sources)
    return cleanup_citation_spacing(normalized_answer), normalized_sources


def strip_all_citation_markers(answer: str) -> str:
    return CITATION_MARKER_RE.sub("", answer)


def rewrite_citation_markers(answer: str, citation_map: "CitationMap") -> str:
    def replace_match(match: re.Match[str]) -> str:
        mapped_numbers = citation_map.remap_marker(match.group(1))
        if not mapped_numbers:
            return ""
        return "".join(f"[{number}]" for number in mapped_numbers)

    return CITATION_MARKER_RE.sub(
        replace_match,
        strip_non_numeric_citation_markers(answer),
    )


def cleanup_citation_spacing(answer: str) -> str:
    cleaned_answer = SPACES_BEFORE_PUNCTUATION_RE.sub(r"\1", answer)
    cleaned_answer = EXTRA_INLINE_SPACES_RE.sub(" ", cleaned_answer)
    return re.sub(r"\n{3,}", "\n\n", cleaned_answer).strip()


def cleanup_citation_fragment(text: str) -> str:
    cleaned_text = SPACES_BEFORE_PUNCTUATION_RE.sub(r"\1", text)
    cleaned_text = EXTRA_INLINE_SPACES_RE.sub(" ", cleaned_text)
    return re.sub(r"\n{3,}", "\n\n", cleaned_text)


class CitationMap:
    def __init__(self, *, total_sources: int):
        self.total_sources = total_sources
        self.original_to_new_number: dict[int, int] = {}
        self.ordered_source_indices: list[int] = []

    def remap_marker(self, marker_content: str) -> list[int]:
        remapped_numbers: list[int] = []
        for original_number in parse_citation_numbers(marker_content):
            if not is_valid_citation_number(
                original_number,
                total_sources=self.total_sources,
            ):
                continue
            remapped_number = self.get_or_create_number(original_number)
            if remapped_number not in remapped_numbers:
                remapped_numbers.append(remapped_number)
        return remapped_numbers

    def get_or_create_number(self, original_number: int) -> int:
        existing_number = self.original_to_new_number.get(original_number)
        if existing_number is not None:
            return existing_number

        source_index = original_number - 1
        self.ordered_source_indices.append(source_index)
        new_number = len(self.ordered_source_indices)
        self.original_to_new_number[original_number] = new_number
        return new_number

    def build_ordered_sources(
        self,
        sources: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        return [sources[index] for index in self.ordered_source_indices]


def parse_citation_numbers(marker_content: str) -> list[int]:
    numbers: list[int] = []
    for part in marker_content.split(","):
        stripped_part = part.strip()
        if not stripped_part.isdigit():
            continue
        numbers.append(int(stripped_part))
    return numbers


def is_valid_citation_number(number: int, *, total_sources: int) -> bool:
    return 1 <= number <= total_sources


def split_complete_citation_text(text: str) -> tuple[str, str]:
    return split_complete_bracket_text(text)


class StreamingCitationNormalizer:
    def __init__(self, *, total_sources: int):
        self.citation_map = CitationMap(total_sources=total_sources)
        self.pending_text = ""
        self.pending_whitespace = ""

    def consume(self, chunk: str) -> str:
        if not chunk:
            return ""
        self.pending_text += chunk
        complete_text, self.pending_text = split_complete_citation_text(
            self.pending_text
        )
        return self._flush_fragment(complete_text, is_final=False)

    def finalize(self) -> str:
        final_text = self.pending_text
        self.pending_text = ""
        return self._flush_fragment(final_text, is_final=True)

    def build_ordered_sources(
        self,
        sources: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        return self.citation_map.build_ordered_sources(sources)

    def _flush_fragment(self, text: str, *, is_final: bool) -> str:
        rewritten_text = rewrite_citation_markers(text, self.citation_map)
        merged_text = f"{self.pending_whitespace}{rewritten_text}"
        normalized_text = cleanup_citation_fragment(merged_text)

        if is_final:
            self.pending_whitespace = ""
            return normalized_text

        trailing_whitespace_match = TRAILING_WHITESPACE_RE.search(normalized_text)
        if trailing_whitespace_match is None:
            self.pending_whitespace = ""
            return normalized_text

        trailing_whitespace = trailing_whitespace_match.group(0)
        self.pending_whitespace = trailing_whitespace
        return normalized_text[: -len(trailing_whitespace)]
