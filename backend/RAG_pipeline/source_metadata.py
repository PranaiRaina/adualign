"""Helpers for stable RAG source identity and display text."""

from __future__ import annotations

import hashlib
import re
from typing import Any

from langchain_core.documents import Document

HANDBOOK_SOURCE_NAME = "ADU Handbook"
LOCAL_HANDBOOK_PDF_URL = "/adu-handbook.pdf"

_SUMMARY_PREFIX_RE = re.compile(r"^\[Summary:[\s\S]*?\]\s*")


def clean_source_text(text: str, page_number: Any = None) -> str:
    """Return PDF-facing text without embedding-only summary prefixes."""
    cleaned = _SUMMARY_PREFIX_RE.sub("", text)
    if page_number is not None:
        cleaned = re.sub(rf"^{re.escape(str(page_number))}\s+", "", cleaned)
    return cleaned.strip()


def source_identity_key(document: Document) -> str:
    """Build a stable dedupe key without collapsing handbook chunks by URL."""
    metadata = document.metadata if hasattr(document, "metadata") else {}
    for field in ("id", "content_hash", "chunk_id"):
        value = metadata.get(field)
        if value:
            return f"{field}:{value}"

    text = document.page_content if hasattr(document, "page_content") else ""
    if text:
        digest = hashlib.sha256(text[:2000].encode("utf-8")).hexdigest()
        return f"content:{digest}"

    url = metadata.get("url")
    if url:
        return f"url:{url}"

    return f"object:{id(document)}"


def is_handbook_source(metadata: dict[str, Any]) -> bool:
    source = str(metadata.get("source") or "").lower()
    return source in {"adu handbook", "adu_handbook"}


def citation_pdf_url(metadata: dict[str, Any]) -> str | None:
    if is_handbook_source(metadata) and metadata.get("page_number") is not None:
        return LOCAL_HANDBOOK_PDF_URL
    return metadata.get("citation_url")
