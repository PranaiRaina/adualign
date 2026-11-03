"""
Ingestion pipeline orchestrator.

Reads the ADU handbook PDF, uploads it to Supabase Storage, applies semantic
chunking, extracts metadata via LLM, embeds with gemini-embedding-001,
and upserts into Supabase pgvector.
"""
# ruff: noqa: E402

from __future__ import annotations

import hashlib
import logging
import os
import re
from pathlib import Path

import sys
from dotenv import load_dotenv

# Add project root to sys.path
root_dir = Path(__file__).resolve().parent.parent.parent
sys.path.append(str(root_dir))

# Load environment variables from .env
load_dotenv(root_dir / ".env")

from api.llm import LONG, build_genai_client
from api.utils import get_api_key
from api.database.core import SessionLocal, supabase_client
from api.database.models import HandbookChunk

logger = logging.getLogger(__name__)

# Paths
RAG_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = RAG_DIR / "data"
PDF_PATH = DATA_DIR / "adu-handbook-update.pdf"
STORAGE_BUCKET = "knowledge-base"
STORAGE_PREFIX = "handbooks"
HANDBOOK_DOCUMENT_VERSION = "March 2026"

PDF_URL = (
    "https://www.hcd.ca.gov/sites/default/files/docs/policy-and-research/"
    "adu-handbook-update.pdf"
)


def ensure_pdf() -> str:
    """Download PDF if missing locally, then upload to Supabase Storage."""
    if not PDF_PATH.exists():
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        try:
            import httpx

            print(f"Downloading PDF from {PDF_URL}...")
            r = httpx.get(PDF_URL, follow_redirects=True, timeout=60)
            r.raise_for_status()
            PDF_PATH.write_bytes(r.content)
            print(f"Saved locally to {PDF_PATH}")
        except Exception as e:
            raise FileNotFoundError(f"PDF download failed: {e}")

    # Upload to Supabase Storage
    if supabase_client:
        try:
            with open(PDF_PATH, "rb") as f:
                storage_path = _versioned_storage_path(PDF_PATH)
                # Check if file exists first to avoid duplicate immutable uploads
                res = supabase_client.storage.from_(STORAGE_BUCKET).list(STORAGE_PREFIX)
                exists = any(item["name"] == Path(storage_path).name for item in res)

                if not exists:
                    print(
                        f"Uploading PDF to Supabase Storage: {STORAGE_BUCKET}/{storage_path}..."
                    )
                    supabase_client.storage.from_(STORAGE_BUCKET).upload(
                        path=storage_path,
                        file=f,
                        file_options={"content-type": "application/pdf"},
                    )

                # Get public URL
                public_url = supabase_client.storage.from_(
                    STORAGE_BUCKET
                ).get_public_url(storage_path)
                print(f"PDF accessible at: {public_url}")
                return public_url
        except Exception as e:
            logger.warning(f"Failed to upload to Supabase Storage: {e}")

    return PDF_URL  # Fallback to original URL


def extract_text_from_pdf() -> list[tuple[int, str]]:
    """Return list of (page_number, text)."""
    from pypdf import PdfReader

    reader = PdfReader(PDF_PATH)
    pages = []
    for i, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        text = re.sub(r"\s+", " ", text).strip()
        text = re.sub(rf"^{i}\s+", "", text)
        if text:
            pages.append((i, text))
    return pages


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _versioned_storage_path(path: Path) -> str:
    digest = _file_sha256(path)[:12]
    return f"{STORAGE_PREFIX}/adu-handbook-update-{digest}.pdf"


def _pdf_page_count(path: Path) -> int:
    from pypdf import PdfReader

    return len(PdfReader(str(path)).pages)


def _embed_texts(texts: list[str], api_key: str) -> list[list[float]]:
    """Embed a batch of texts using gemini-embedding-001 via google-genai."""
    client = build_genai_client(tier=LONG, api_key=api_key)

    all_embeddings: list[list[float]] = []
    batch_size = 100
    for i in range(0, len(texts), batch_size):
        batch = texts[i : i + batch_size]
        # Embed the batch
        result = client.models.embed_content(
            model="gemini-embedding-001",
            contents=batch,
        )
        batch_embeddings = result.embeddings or []
        all_embeddings.extend(
            [embedding.values for embedding in batch_embeddings if embedding.values]
        )
        print(f"  Embedded {min(i + batch_size, len(texts))}/{len(texts)} chunks")

    return all_embeddings


def _replace_existing_chunks() -> None:
    with SessionLocal() as db:
        deleted_count = db.query(HandbookChunk).delete(synchronize_session=False)
        db.commit()
    print(f"Deleted {deleted_count} existing documents from 'handbook_chunks'.")


def run_ingestion(*, replace_existing: bool = False) -> None:
    """Execute the full ingestion pipeline (PostgreSQL/pgvector version)."""
    from RAG_pipeline.ingestion.chunking import semantic_chunk
    from RAG_pipeline.ingestion.extraction import extract_metadata, generate_summary

    api_key = get_api_key()
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY not set.")

    public_pdf_url = ensure_pdf()
    pdf_sha256 = _file_sha256(PDF_PATH)
    pdf_page_count = _pdf_page_count(PDF_PATH)

    if replace_existing:
        _replace_existing_chunks()

    # Step 1: Extract text
    print("Extracting text from PDF...")
    pages = extract_text_from_pdf()
    print(f"  {len(pages)} pages with text")

    # Step 2: Semantic chunking
    print("Chunking text...")
    chunks = semantic_chunk(pages)
    print(f"  {len(chunks)} chunks created")

    # Step 3: Deduplication check against PostgreSQL
    new_chunks = []
    with SessionLocal() as db:
        for chunk in chunks:
            content_hash = _sha256(chunk["text"])
            # Check if this content already exists in PG
            exists = (
                db.query(HandbookChunk)
                .filter(
                    HandbookChunk.metadata_json["content_hash"].astext == content_hash
                )
                .first()
            )

            if exists:
                continue

            chunk["content_hash"] = content_hash
            new_chunks.append(chunk)

    print(f"  {len(new_chunks)} new chunks to process (after dedup)")

    if not new_chunks:
        print("No new chunks to ingest. Done.")
        return

    # Step 4: Extract metadata and generate summaries (PARALLEL)
    print("Extracting metadata and generating summaries in parallel...")
    import asyncio

    async def process_chunk(c, idx):
        metadata = await asyncio.to_thread(extract_metadata, c["text"])
        metadata["page_number"] = c["page"]
        metadata["content_hash"] = c["content_hash"]
        metadata["source_url"] = public_pdf_url
        metadata["canonical_public_url"] = PDF_URL
        metadata["document_version"] = HANDBOOK_DOCUMENT_VERSION
        metadata["pdf_sha256"] = pdf_sha256
        metadata["page_count"] = pdf_page_count
        c["metadata"] = metadata

        if metadata.get("is_structural") == "True":
            c["skip"] = True
            return

        summary = await asyncio.to_thread(generate_summary, c["text"])
        c["enriched_text"] = f"[Summary: {summary}]\n\n{c['text']}"
        c["skip"] = False
        if (idx + 1) % 10 == 0:
            print(f"  Processed {idx + 1}/{len(new_chunks)} chunks")

    async def process_all():
        tasks = [process_chunk(chunk, i) for i, chunk in enumerate(new_chunks)]
        batch_size = 15
        for i in range(0, len(tasks), batch_size):
            await asyncio.gather(*tasks[i : i + batch_size])

    asyncio.run(process_all())

    final_chunks = [c for c in new_chunks if not c.get("skip", False)]
    print(
        f"  Metadata extraction complete. {len(new_chunks) - len(final_chunks)} structural chunks skipped."
    )

    if not final_chunks:
        print("All new chunks were structural. Done.")
        return

    # Step 5: Embed enriched texts
    print(f"Embedding {len(final_chunks)} chunks with gemini-embedding-001...")
    enriched_texts = [c["enriched_text"] for c in final_chunks]
    embeddings = _embed_texts(enriched_texts, api_key)

    # Step 6: Upsert into PostgreSQL
    print("Upserting into Supabase pgvector...")
    with SessionLocal() as db:
        for i, chunk in enumerate(final_chunks):
            db_chunk = HandbookChunk(
                content=chunk["enriched_text"],
                metadata_json=chunk["metadata"],
                embedding=embeddings[i],
            )
            db.add(db_chunk)

        db.commit()
        total_count = db.query(HandbookChunk).count()
        print(f"Done. PostgreSQL now has {total_count} documents in 'handbook_chunks'.")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run_ingestion(replace_existing=os.getenv("REPLACE_HANDBOOK_CHUNKS") == "1")
