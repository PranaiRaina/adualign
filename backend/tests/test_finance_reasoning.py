import financial_chatbot.graph as fg
from api.rate_limiting.llm_pricing import DEFAULT_REASONING_LEVEL, REASONING_MINIMAL


class _FakeLlm:
    def with_structured_output(self, _schema, *, include_raw=False):
        return self


def _capture(monkeypatch):
    captured: dict[str, object] = {}

    def fake_build(**kwargs):
        captured["reasoning_level"] = kwargs.get("reasoning_level")
        return _FakeLlm()

    monkeypatch.setattr(fg, "build_chat_llm", fake_build)
    return captured


class _Schema:  # minimal stand-in for a pydantic schema
    pass


def test_build_finance_structured_llm_passes_minimal_level(monkeypatch):
    captured = _capture(monkeypatch)
    fg.build_finance_structured_llm(_Schema, level=REASONING_MINIMAL)
    assert captured["reasoning_level"] == REASONING_MINIMAL


def test_build_finance_llm_defaults_to_medium(monkeypatch):
    captured = _capture(monkeypatch)
    fg.build_finance_llm()
    assert captured["reasoning_level"] == DEFAULT_REASONING_LEVEL
