import os
from types import SimpleNamespace

from scripts.audit_usage_vs_langsmith import (
    _aggregate_backend_rows,
    _configure_database_env,
)


def test_configure_database_env_accepts_legacy_alias(monkeypatch):
    monkeypatch.delenv("SUPABASE_DATABASE_URL", raising=False)
    monkeypatch.setenv("DATABASE_URL", "postgresql://example")

    _configure_database_env()

    assert os.environ["SUPABASE_DATABASE_URL"] == "postgresql://example"


def _row(*, request_id, cost_micros, provider="openrouter", is_estimated=False):
    return SimpleNamespace(
        request_id=request_id,
        cost_micros=cost_micros,
        is_estimated=is_estimated,
        route="rag",
        model=provider,
        provider=provider,
    )


def test_aggregate_sums_multiple_llm_rows_sharing_a_request_id():
    rows = [
        _row(request_id="req-1", cost_micros=10_000),
        _row(request_id="req-1", cost_micros=3_000),
    ]

    grouped = _aggregate_backend_rows(rows)

    assert set(grouped) == {"req-1"}
    assert grouped["req-1"]["cost_micros"] == 13_000


def test_aggregate_excludes_serper_rows():
    # Serper is not traced by LangSmith, so it must not count toward the
    # backend side of the LLM-cost comparison.
    rows = [
        _row(request_id="req-1", cost_micros=10_000, provider="openrouter"),
        _row(request_id="req-1", cost_micros=2_000, provider="serper"),
    ]

    grouped = _aggregate_backend_rows(rows)

    assert grouped["req-1"]["cost_micros"] == 10_000


def test_aggregate_marks_request_estimated_if_any_row_is_estimated():
    rows = [
        _row(request_id="req-1", cost_micros=10_000, is_estimated=False),
        _row(request_id="req-1", cost_micros=5_000, is_estimated=True),
    ]

    grouped = _aggregate_backend_rows(rows)

    assert grouped["req-1"]["is_estimated"] is True
    assert grouped["req-1"]["cost_micros"] == 15_000
