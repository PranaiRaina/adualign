from __future__ import annotations

from RAG_pipeline.graph.nodes import rephraser as rephraser_module
from RAG_pipeline.graph.nodes.rephraser import rephraser_node
from RAG_pipeline.schemas import RephraseResponse


def _state(question: str, **context):
    return {
        "question": question,
        "original_question": question,
        "documents": [],
        "run_web_search": False,
        "frontend_context": context,
    }


def test_rephraser_marks_local_intent_without_an_extra_call(monkeypatch):
    class FakeLlm:
        def invoke(self, prompt):
            assert "Orange County" in prompt
            return {
                "parsed": RephraseResponse(
                    query="Orange County ADU permit requirements",
                    assess_local_evidence=True,
                ),
                "raw": None,
            }

    monkeypatch.setattr(rephraser_module, "get_openrouter_key", lambda: "test-key")
    monkeypatch.setattr(
        rephraser_module,
        "build_chat_llm",
        lambda **kwargs: FakeLlm(),
    )

    result = rephraser_node(_state("What permits do I need?", county="Orange County"))

    assert result["question"] == "Orange County ADU permit requirements"
    assert result["assess_local_evidence"] is True


def test_rephraser_marks_statewide_question_as_not_local(monkeypatch):
    class FakeLlm:
        def invoke(self, prompt):
            return {
                "parsed": RephraseResponse(
                    query="California statewide ADU size limit",
                    assess_local_evidence=False,
                ),
                "raw": None,
            }

    monkeypatch.setattr(rephraser_module, "get_openrouter_key", lambda: "test-key")
    monkeypatch.setattr(
        rephraser_module,
        "build_chat_llm",
        lambda **kwargs: FakeLlm(),
    )

    result = rephraser_node(
        _state(
            "What is California's statewide ADU size limit?",
            county="Orange County",
        )
    )

    assert result["assess_local_evidence"] is False


def test_rephraser_uses_minimal_reasoning(monkeypatch):
    from api.rate_limiting.llm_pricing import REASONING_MINIMAL

    captured: dict[str, object] = {}

    class FakeLlm:
        def invoke(self, _prompt):
            return {
                "parsed": RephraseResponse(
                    query="What is an ADU?",
                    assess_local_evidence=False,
                ),
                "raw": None,
            }

    def fake_build(**kwargs):
        captured["reasoning_level"] = kwargs.get("reasoning_level")
        return FakeLlm()

    monkeypatch.setattr(rephraser_module, "get_openrouter_key", lambda: "test-key")
    monkeypatch.setattr(rephraser_module, "build_chat_llm", fake_build)

    rephraser_node(_state("What is an ADU?"))
    assert captured["reasoning_level"] == REASONING_MINIMAL
