"""
Semantic chunking for ADU handbook documents.

Splits text on paragraph/section boundaries and generates a summary
prefix for each chunk to improve embedding quality.
"""

from __future__ import annotations

import re


# Section-heading pattern — captures "Chapter X", numbered sections, and ALL-CAPS headers
_SECTION_RE = re.compile(
    r"(?:^|\n)"
    r"(?:"
    r"(?:Chapter|Section|CHAPTER|SECTION)\s+\d+"
    r"|(?:\d+\.)+\s+[A-Z]"
    r"|[A-Z][A-Z\s]{4,}"
    r")"
)

# Target chunk size in characters (generous — gemini-embedding-001 supports 8K *tokens*)
CHUNK_TARGET = 1500
CHUNK_MAX = 2500
CHUNK_OVERLAP = 200


def _split_into_paragraphs(text: str) -> list[str]:
    """Split text into paragraphs, preserving meaningful boundaries."""
    paragraphs = re.split(r"\n{2,}", text)
    return [p.strip() for p in paragraphs if p.strip()]


def semantic_chunk(
    pages: list[tuple[int, str]],
) -> list[dict]:
    """
    Chunk pages into semantically coherent pieces.

    Args:
        pages: List of (page_number, page_text) tuples.

    Returns:
        List of dicts with keys: ``text``, ``page``, ``chunk_id``.
    """
    chunks: list[dict] = []
    chunk_idx = 0

    for page_num, page_text in pages:
        paragraphs = _split_into_paragraphs(page_text)
        if not paragraphs:
            continue

        current_parts: list[str] = []
        current_len = 0

        for para in paragraphs:
            is_section_boundary = bool(_SECTION_RE.match(para))

            if current_parts and (
                current_len + len(para) > CHUNK_TARGET or is_section_boundary
            ):
                chunk_text = "\n\n".join(current_parts)
                chunks.append(
                    {
                        "text": chunk_text,
                        "page": page_num,
                        "chunk_id": f"p{page_num}_c{chunk_idx}",
                    }
                )
                chunk_idx += 1

                # Keep overlap from end of previous chunk
                overlap_text = (
                    chunk_text[-CHUNK_OVERLAP:]
                    if len(chunk_text) > CHUNK_OVERLAP
                    else ""
                )
                current_parts = [overlap_text] if overlap_text else []
                current_len = len(overlap_text)

            current_parts.append(para)
            current_len += len(para)

            # Hard-split if a single paragraph is enormous
            if current_len > CHUNK_MAX:
                chunk_text = "\n\n".join(current_parts)
                chunks.append(
                    {
                        "text": chunk_text[:CHUNK_MAX],
                        "page": page_num,
                        "chunk_id": f"p{page_num}_c{chunk_idx}",
                    }
                )
                chunk_idx += 1
                remainder = chunk_text[CHUNK_MAX - CHUNK_OVERLAP :]
                current_parts = [remainder] if remainder.strip() else []
                current_len = len(remainder) if remainder.strip() else 0

        # Flush remaining content for this page
        if current_parts:
            chunk_text = "\n\n".join(current_parts)
            if chunk_text.strip():
                chunks.append(
                    {
                        "text": chunk_text,
                        "page": page_num,
                        "chunk_id": f"p{page_num}_c{chunk_idx}",
                    }
                )
                chunk_idx += 1

    return chunks
