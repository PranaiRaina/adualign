from __future__ import annotations

from types import SimpleNamespace

import pytest
from langchain_core.documents import Document

from api.llm import litellm_client
from RAG_pipeline.graph.nodes import generator as generator_node_module


def _build_completion_response(
    *,
    content: str,
    usage: object | None = None,
):
    return SimpleNamespace(
        choices=[
            SimpleNamespace(
                message=SimpleNamespace(content=content),
            )
        ],
        usage=usage,
    )


def test_build_instructions_includes_estimate_context_for_rag_answers():
    instructions = generator_node_module.build_instructions(
        documents=[Document(page_content="Local agencies may review ADU permits.")],
        frontend_ctx={
            "finance_state": {
                "county": "Los Angeles",
                "adu_sqft": 750,
                "adu_type": "detached",
                "base_estimate_range": {"low": 240000, "high": 360000},
                "complication_adjusted_range": {"low": 256000, "high": 384000},
                "complication_flags": {
                    "slope": True,
                    "demolition": False,
                    "electric_panel": False,
                    "septic_tank": False,
                    "solar_mandate": False,
                    "fire_resilient_upgrades": False,
                    "hoa_restrictions": False,
                    "very_high_fire_risk": False,
                    "contingency": False,
                },
            }
        },
    )

    assert "**LOCAL ESTIMATE CONTEXT (not a citeable source):**" in instructions
    assert "Current estimate range: $256,000 - $384,000" in instructions
    assert "Cost items currently included in the estimate" in instructions
    assert "Slope / retaining wall work" in instructions
    assert "Calculator-supported cost items not currently included" in instructions


def test_build_instructions_uses_pdf_text_without_embedding_summary():
    instructions = generator_node_module.build_instructions(
        documents=[
            Document(
                page_content=(
                    "[Summary: This chunk discusses a four-foot setback.]\n\n"
                    "12 Rear and side setbacks are often four feet."
                ),
                metadata={"id": "doc-1", "page_number": 12},
            )
        ],
        frontend_ctx={},
    )

    assert "[Summary:" not in instructions
    assert "Rear and side setbacks are often four feet." in instructions


def test_build_instructions_distinguishes_handbook_and_web_authority():
    instructions = generator_node_module.build_instructions(
        documents=[
            Document(
                page_content="Statewide setback baseline.",
                metadata={"source": "ADU Handbook"},
            ),
            Document(
                page_content="Irvine permit requirement.",
                metadata={
                    "source": "web_search",
                    "authority": "official",
                    "url": "https://cityofirvine.org/adu",
                },
            ),
            Document(
                page_content="Professional permitting explanation.",
                metadata={
                    "source": "web_search",
                    "authority": "professional",
                    "url": "https://planningfirm.example/adu",
                },
            ),
        ],
        frontend_ctx={},
    )

    assert "[1] (California ADU Handbook)" in instructions
    assert "[2] (Official local web evidence)" in instructions
    assert "[3] (Vetted professional web evidence)" in instructions
    assert (
        "Use the California ADU Handbook as the authority for statewide" in instructions
    )


def test_build_instructions_requires_unverified_local_disclosure():
    instructions = generator_node_module.build_instructions(
        documents=[Document(page_content="Consult local setback rules.")],
        frontend_ctx={
            "_rag_evidence_strategy": "handbook_plus_web",
            "_rag_web_search_status": "no_trusted_results",
        },
    )

    assert "Trusted local evidence was not available" in instructions
    assert "local requirement was not verified" in instructions


@pytest.mark.anyio
async def test_generator_node_populates_generation_and_records_usage(monkeypatch):
    recorded_usage_calls: list[dict[str, object]] = []
    captured_messages: list[dict[str, str]] = []
    usage = SimpleNamespace(
        prompt_tokens=12,
        completion_tokens=8,
        total_tokens=20,
        prompt_tokens_details=SimpleNamespace(cached_tokens=0),
    )

    async def fake_acompletion(**kwargs):
        captured_messages.extend(kwargs["messages"])
        return _build_completion_response(
            content="Use the local setbacks as your starting point [CURRENT REPORT STATE]. [1]",
            usage=usage,
        )

    monkeypatch.setattr(generator_node_module, "get_openrouter_key", lambda: "test-key")
    monkeypatch.setattr(
        litellm_client.litellm,
        "acompletion",
        fake_acompletion,
    )
    monkeypatch.setattr(
        generator_node_module,
        "record_litellm_usage",
        lambda **kwargs: recorded_usage_calls.append(kwargs),
    )

    state = await generator_node_module.generator_node(
        {
            "question": "What are the setbacks?",
            "original_question": "Briefly, what are the setbacks?",
            "documents": [Document(page_content="Rear setbacks are often four feet.")],
            "run_web_search": False,
            "generation": "",
            "frontend_context": {},
        }
    )

    assert state["generation"] == "Use the local setbacks as your starting point. [1]"
    assert captured_messages[1]["content"] == "Briefly, what are the setbacks?"
    assert recorded_usage_calls == [
        {
            "model": "deepseek-v4-flash",
            "usage": usage,
            "route": "rag",
            "source": "rag.generator.batch",
        }
    ]


@pytest.mark.anyio
async def test_generator_node_appends_local_verification_caveat(monkeypatch):
    async def fake_completion(**kwargs):
        return "The statewide baseline is four feet.", None

    monkeypatch.setattr(generator_node_module, "get_openrouter_key", lambda: "test-key")
    monkeypatch.setattr(
        generator_node_module,
        "_run_text_completion",
        fake_completion,
    )
    monkeypatch.setattr(
        generator_node_module,
        "record_litellm_usage",
        lambda **kwargs: None,
    )
    state = {
        "question": "What is my local setback?",
        "original_question": "What is my local setback?",
        "documents": [Document(page_content="The statewide baseline is four feet.")],
        "run_web_search": True,
        "evidence_strategy": "handbook_plus_web",
        "web_search_status": "no_trusted_results",
        "generation": "",
        "frontend_context": {},
    }

    result = await generator_node_module.generator_node(state)

    assert result["generation"].endswith(
        "Confirm it with your city or county planning or building department."
    )


@pytest.mark.anyio
async def test_generate_suggested_questions_parses_valid_json_and_records_usage(
    monkeypatch,
):
    recorded_usage_calls: list[dict[str, object]] = []
    captured_kwargs: list[dict[str, object]] = []
    usage = SimpleNamespace(
        prompt_tokens=10,
        completion_tokens=6,
        total_tokens=16,
        prompt_tokens_details=SimpleNamespace(cached_tokens=0),
    )

    async def fake_acompletion(**kwargs):
        captured_kwargs.append(kwargs)
        return _build_completion_response(
            content='{"questions":["What about side setbacks?","What permits apply?"]}',
            usage=usage,
        )

    monkeypatch.setattr(generator_node_module, "get_openrouter_key", lambda: "test-key")
    monkeypatch.setattr(
        litellm_client.litellm,
        "acompletion",
        fake_acompletion,
    )
    monkeypatch.setattr(
        generator_node_module,
        "record_litellm_usage",
        lambda **kwargs: recorded_usage_calls.append(kwargs),
    )

    questions = await generator_node_module.generate_suggested_questions(
        "Can I build a detached ADU?",
        "Yes, in many residential contexts you can. [1]",
    )

    assert questions == ["What about side setbacks?", "What permits apply?"]
    assert captured_kwargs[0]["response_format"] == {"type": "json_object"}
    assert recorded_usage_calls == [
        {
            "model": "deepseek-v4-flash",
            "usage": usage,
            "route": "rag",
            "source": "rag.followups",
        }
    ]


@pytest.mark.anyio
async def test_stream_generation_ignores_usage_only_terminal_chunk_and_records_usage(
    monkeypatch,
):
    reconcile_calls: list[dict[str, object]] = []
    usage = SimpleNamespace(
        prompt_tokens=10,
        completion_tokens=6,
        total_tokens=16,
        prompt_tokens_details=SimpleNamespace(cached_tokens=0),
    )

    async def fake_stream():
        yield SimpleNamespace(
            id="gen-rag",
            choices=[
                SimpleNamespace(
                    delta=SimpleNamespace(content="Final answer [CURRENT REPORT")
                )
            ],
            usage=None,
        )
        yield SimpleNamespace(
            id="gen-rag",
            choices=[SimpleNamespace(delta=SimpleNamespace(content=" STATE]. [1]"))],
            usage=None,
        )
        yield SimpleNamespace(id="gen-rag", choices=[], usage=usage)

    async def fake_acompletion(**kwargs):
        assert kwargs["stream"] is True
        assert kwargs["stream_options"] == {"include_usage": True}
        return fake_stream()

    def fake_record(**kwargs):
        reconcile_calls.append(kwargs)

    monkeypatch.setattr(generator_node_module, "get_openrouter_key", lambda: "test-key")
    monkeypatch.setattr(
        litellm_client.litellm,
        "acompletion",
        fake_acompletion,
    )
    monkeypatch.setattr(
        generator_node_module,
        "record_litellm_usage",
        fake_record,
    )

    chunks = []
    async for chunk in generator_node_module.stream_generation(
        question="What are the setbacks?",
        documents=[Document(page_content="Rear setbacks are often four feet.")],
        frontend_ctx={},
    ):
        chunks.append(chunk)

    assert "".join(chunks) == "Final answer. [1]"
    # Cost is recorded from the streamed usage as a static estimate — no
    # post-stream generation-endpoint fetch.
    assert reconcile_calls == [
        {
            "model": "deepseek-v4-flash",
            "usage": usage,
            "route": "rag",
            "source": "rag.generator.stream",
        }
    ]


@pytest.mark.anyio
async def test_generate_suggested_questions_parses_fenced_json_parts_content(
    monkeypatch,
):
    usage = SimpleNamespace(
        prompt_tokens=10,
        completion_tokens=6,
        total_tokens=16,
        prompt_tokens_details=SimpleNamespace(cached_tokens=0),
    )

    async def fake_acompletion(**kwargs):
        return SimpleNamespace(
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(
                        content=[
                            {"text": "```json\n"},
                            {"text": '{"questions":["What about parking?"]}'},
                            {"text": "\n```"},
                        ]
                    )
                )
            ],
            usage=usage,
        )

    monkeypatch.setattr(generator_node_module, "get_openrouter_key", lambda: "test-key")
    monkeypatch.setattr(
        litellm_client.litellm,
        "acompletion",
        fake_acompletion,
    )

    questions = await generator_node_module.generate_suggested_questions(
        "Can I build a detached ADU?",
        "Yes, in many residential contexts you can. [1]",
    )

    assert questions == ["What about parking?"]


@pytest.mark.anyio
async def test_generate_suggested_questions_falls_back_to_empty_list_on_malformed_output_and_still_records_usage(
    monkeypatch,
):
    recorded_usage_calls: list[dict[str, object]] = []
    usage = SimpleNamespace(
        prompt_tokens=9,
        completion_tokens=5,
        total_tokens=14,
        prompt_tokens_details=SimpleNamespace(cached_tokens=0),
    )

    async def fake_acompletion(**kwargs):
        return _build_completion_response(content="{not-json", usage=usage)

    monkeypatch.setattr(generator_node_module, "get_openrouter_key", lambda: "test-key")
    monkeypatch.setattr(
        litellm_client.litellm,
        "acompletion",
        fake_acompletion,
    )
    monkeypatch.setattr(
        generator_node_module,
        "record_litellm_usage",
        lambda **kwargs: recorded_usage_calls.append(kwargs),
    )

    questions = await generator_node_module.generate_suggested_questions(
        "Can I build a detached ADU?",
        "Yes, in many residential contexts you can. [1]",
    )

    assert questions == []
    assert recorded_usage_calls == [
        {
            "model": "deepseek-v4-flash",
            "usage": usage,
            "route": "rag",
            "source": "rag.followups",
        }
    ]
