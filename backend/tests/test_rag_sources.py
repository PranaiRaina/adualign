from langchain_core.documents import Document

from RAG_pipeline.router import _extract_sources
from RAG_pipeline.source_metadata import clean_source_text, source_identity_key


def test_clean_source_text_removes_embedding_summary_and_page_prefix():
    text = (
        "[Summary: Setbacks overview.]\n\n44 Rear setbacks often depend on local rules."
    )

    assert clean_source_text(text, page_number=44) == (
        "Rear setbacks often depend on local rules."
    )


def test_clean_source_text_preserves_leading_numbers_without_page_metadata():
    text = (
        "[Summary: Size overview.]\n\n800 square foot ADUs may be treated differently."
    )

    assert clean_source_text(text) == (
        "800 square foot ADUs may be treated differently."
    )


def test_source_identity_does_not_collapse_chunks_that_share_url():
    first = Document(
        page_content="First handbook chunk.",
        metadata={"url": "https://example.com/handbook.pdf"},
    )
    second = Document(
        page_content="Second handbook chunk.",
        metadata={"url": "https://example.com/handbook.pdf"},
    )

    assert source_identity_key(first) != source_identity_key(second)


def test_extract_sources_adds_local_handbook_citation_url():
    sources = _extract_sources(
        [
            Document(
                page_content="[Summary: Foo.]\n\n12 Detached ADUs are allowed.",
                metadata={
                    "id": "doc-1",
                    "source": "adu_handbook",
                    "page_number": 12,
                    "url": "https://www.hcd.ca.gov/adu-handbook-update.pdf",
                },
            )
        ]
    )

    assert sources == [
        {
            "page_number": 12,
            "source": "adu_handbook",
            "regulation_topic": None,
            "chunk_text": "Detached ADUs are allowed.",
            "url": "https://www.hcd.ca.gov/adu-handbook-update.pdf",
            "citation_url": "/adu-handbook.pdf",
        }
    ]


def test_extract_sources_preserves_web_citation_url_and_text():
    sources = _extract_sources(
        [
            Document(
                page_content="Irvine publishes local ADU permit requirements.",
                metadata={
                    "source": "web_search",
                    "regulation_topic": "Irvine ADU Standards",
                    "url": "https://cityofirvine.org/adu",
                    "authority": "official",
                },
            )
        ]
    )

    assert sources == [
        {
            "page_number": None,
            "source": "web_search",
            "regulation_topic": "Irvine ADU Standards",
            "chunk_text": "Irvine publishes local ADU permit requirements.",
            "url": "https://cityofirvine.org/adu",
            "citation_url": None,
        }
    ]
