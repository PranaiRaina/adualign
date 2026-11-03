"""
Retriever node — adaptive K retrieval from Supabase pgvector.

Detects broad vs. specific queries and adjusts chunk count dynamically.
Uses gemini-embedding-001 for query embedding.
Queries the 'handbook_chunks' table in PostgreSQL using vector similarity.
"""

from __future__ import annotations

import logging

from langchain_core.documents import Document

from api.llm import FAST, build_genai_client
from api.utils import get_api_key
from api.database.core import SessionLocal
from api.database.models import HandbookChunk
from api.rate_limiting.llm_usage import record_embedding_estimate
from RAG_pipeline.schemas import GraphState

logger = logging.getLogger(__name__)

# Adaptive K values
K_BROAD = 10
K_SPECIFIC = 5
K_DEFAULT = 6

# Broad query indicators
_BROAD_KEYWORDS = {"what", "how", "overview", "explain", "tell me about", "general"}
_SPECIFIC_KEYWORDS = {
    "setback",
    "fee",
    "permit",
    "height",
    "size",
    "sqft",
    "zoning",
    "R-1",
    "R-2",
    "JADU",
}


def _determine_k(question: str) -> int:
    """Adaptive K: broad queries get more chunks, specific ones get fewer."""
    q_lower = question.lower()
    if any(kw in q_lower for kw in _BROAD_KEYWORDS):
        return K_BROAD
    if any(kw in q_lower for kw in _SPECIFIC_KEYWORDS):
        return K_SPECIFIC
    return K_DEFAULT


def retriever_node(state: GraphState) -> GraphState:
    """Retrieve relevant documents from Supabase pgvector."""
    question = state["question"]

    try:
        api_key = get_api_key()
        if not api_key:
            raise RuntimeError("GEMINI_API_KEY not set")

        client = build_genai_client(tier=FAST, api_key=api_key)

        # Embed the query
        result = client.models.embed_content(
            model="gemini-embedding-001",
            contents=question,
        )
        record_embedding_estimate(
            model="gemini-embedding-001",
            char_count=len(question),
            route="rag",
            source="rag.retriever.embedding",
        )
        embeddings = result.embeddings or []
        if not embeddings:
            raise RuntimeError("Embedding API returned no embeddings")
        query_embedding = embeddings[0].values

        # Determine adaptive K
        k = _determine_k(question)

        documents: list[Document] = []
        with SessionLocal() as db:
            # PostgreSQL Similarity Search using pgvector's cosine distance operator (<=>)
            query = (
                db.query(
                    HandbookChunk,
                    HandbookChunk.embedding.cosine_distance(query_embedding).label(
                        "distance"
                    ),
                )
                .order_by("distance")
                .limit(k)
            )

            results = query.all()

            for chunk, distance in results:
                metadata = chunk.metadata_json or {}
                metadata["id"] = str(chunk.id)
                metadata["_distance"] = float(distance)
                # Map source_url for the frontend preview
                metadata["url"] = metadata.get("source_url")
                metadata["source"] = "ADU Handbook"

                documents.append(
                    Document(page_content=chunk.content, metadata=metadata)
                )

        logger.info(
            "Retrieved %d documents from Supabase (k=%d, top_dist=%.4f)",
            len(documents),
            k,
            documents[0].metadata["_distance"] if documents else 0.0,
        )

        state["documents"] = documents

    except Exception as exc:
        logger.error("Retriever failed: %s", exc)
        state["documents"] = []

    return state
