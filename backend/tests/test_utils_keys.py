from api import utils


def test_get_openrouter_key_reads_env(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-test")
    assert utils.get_openrouter_key() == "sk-or-test"


def test_get_groq_key_is_removed():
    assert not hasattr(utils, "get_groq_key")
