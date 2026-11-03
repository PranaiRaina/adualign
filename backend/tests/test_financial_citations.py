from financial_chatbot.citations import (
    StreamingCitationNormalizer,
    normalize_finance_chat_citations,
)


def build_sources(count: int) -> list[dict]:
    return [
        {
            "source": f"Source {index}",
            "url": f"https://example.com/{index}",
        }
        for index in range(1, count + 1)
    ]


def test_normalize_finance_chat_citations_removes_out_of_range_markers():
    answer, sources = normalize_finance_chat_citations(
        "Steel framing can improve durability [13].",
        build_sources(5),
    )

    assert answer == "Steel framing can improve durability."
    assert sources == []


def test_normalize_finance_chat_citations_removes_internal_context_labels():
    answer, sources = normalize_finance_chat_citations(
        "The setback is 4 feet [CURRENT REPORT STATE]. State law can still matter [2].",
        build_sources(3),
    )

    assert answer == "The setback is 4 feet. State law can still matter [1]."
    assert [source["source"] for source in sources] == ["Source 2"]


def test_normalize_finance_chat_citations_preserves_markdown_links():
    answer, sources = normalize_finance_chat_citations(
        "Review the [calculator guide](https://example.com) and local estimate [Payload].",
        build_sources(1),
    )

    assert (
        answer
        == "Review the [calculator guide](https://example.com) and local estimate."
    )
    assert sources == []


def test_normalize_finance_chat_citations_reindexes_sparse_markers():
    answer, sources = normalize_finance_chat_citations(
        "Steel framing costs more upfront [3]. Modular construction can save time [5].",
        build_sources(5),
    )

    assert (
        answer
        == "Steel framing costs more upfront [1]. Modular construction can save time [2]."
    )
    assert [source["source"] for source in sources] == ["Source 3", "Source 5"]


def test_normalize_finance_chat_citations_splits_combined_markers():
    answer, sources = normalize_finance_chat_citations(
        "Cost differences vary by project [7, 8].",
        build_sources(10),
    )

    assert answer == "Cost differences vary by project [1][2]."
    assert [source["source"] for source in sources] == ["Source 7", "Source 8"]


def test_normalize_finance_chat_citations_deduplicates_repeated_markers():
    answer, sources = normalize_finance_chat_citations(
        "Prefabrication can reduce schedule risk [4, 4].",
        build_sources(6),
    )

    assert answer == "Prefabrication can reduce schedule risk [1]."
    assert [source["source"] for source in sources] == ["Source 4"]


def test_normalize_finance_chat_citations_strips_markers_when_no_sources_exist():
    answer, sources = normalize_finance_chat_citations(
        "Construction loans can help [1].",
        [],
    )

    assert answer == "Construction loans can help."
    assert sources == []


def test_streaming_citation_normalizer_rewrites_markers_across_chunk_boundaries():
    normalizer = StreamingCitationNormalizer(total_sources=8)

    first_chunk = normalizer.consume("Cost differences vary by project [7")
    second_chunk = normalizer.consume(", 8]. Prefabrication can help [13")
    third_chunk = normalizer.consume("].")
    final_chunk = normalizer.finalize()

    answer = "".join([first_chunk, second_chunk, third_chunk, final_chunk])
    sources = normalizer.build_ordered_sources(build_sources(8))

    assert answer == "Cost differences vary by project [1][2]. Prefabrication can help."
    assert [source["source"] for source in sources] == ["Source 7", "Source 8"]


def test_streaming_citation_normalizer_strips_split_internal_labels():
    normalizer = StreamingCitationNormalizer(total_sources=2)

    chunks = [
        normalizer.consume("The property is in LA County [CURRENT"),
        normalizer.consume(" REPORT STATE]. External rule applies [2]."),
        normalizer.finalize(),
    ]

    assert "".join(chunks) == "The property is in LA County. External rule applies [1]."
    assert [
        source["source"]
        for source in normalizer.build_ordered_sources(build_sources(2))
    ] == ["Source 2"]
