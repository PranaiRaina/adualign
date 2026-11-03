"""Serper external-API cost tracking (provider-aware usage logging)."""

from __future__ import annotations

import hashlib
import os

import pytest

import api.rate_limiting.rate_limiter as rl
from api.rate_limiting.llm_pricing import SERPER_COST_MICROS
from api.rate_limiting.llm_usage import (
    LLMUsageBreakdown,
    LLMUsageSummary,
    record_serper_usage,
    record_usage_breakdown,
    usage_accumulator_scope,
)
from api.rate_limiting.rate_limiter import (
    ApiKeyConfig,
    reserve_llm_budget,
    set_upstash_client_for_testing,
    _usage_log_rows,
)

FAKE_HASH = hashlib.sha256(b"serper-test-key").hexdigest()
FAKE_CONFIG = ApiKeyConfig(
    chat_usage_id="ak-serper",
    is_active=True,
    budget_micros=1_000_000,
    budget_currency="USD",
)


def _chat_breakdown(
    *,
    cost_micros: int = 10_000,
    prompt_tokens: int = 100,
    completion_tokens: int = 50,
    source: str = "rag.rephraser",
) -> LLMUsageBreakdown:
    return LLMUsageBreakdown(
        model="deepseek-v4-flash",
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=prompt_tokens + completion_tokens,
        cached_tokens=0,
        cost_micros=cost_micros,
        is_estimated=False,
        route="rag",
        source=source,
    )


def _serper_breakdown(*, cost_micros: int = 2_000) -> LLMUsageBreakdown:
    return LLMUsageBreakdown(
        model="serper",
        provider="serper",
        prompt_tokens=0,
        completion_tokens=0,
        total_tokens=0,
        cached_tokens=0,
        cost_micros=cost_micros,
        is_estimated=False,
        route="rag",
        source="rag.web_search",
    )


def _summary(breakdowns: list[LLMUsageBreakdown]) -> LLMUsageSummary:
    return LLMUsageSummary(
        model="multiple"
        if len({b.model for b in breakdowns}) > 1
        else breakdowns[0].model,
        prompt_tokens=sum(b.prompt_tokens for b in breakdowns),
        completion_tokens=sum(b.completion_tokens for b in breakdowns),
        total_tokens=sum(b.total_tokens for b in breakdowns),
        cached_tokens=sum(b.cached_tokens for b in breakdowns),
        cost_micros=sum(b.cost_micros for b in breakdowns),
        is_estimated=any(b.is_estimated for b in breakdowns),
        breakdowns=breakdowns,
    )


def test_serper_cost_micros_is_one_thousandth_of_a_dollar():
    # $0.001 per call == 1000 micros (millionths of a dollar).
    assert SERPER_COST_MICROS == 1_000


def test_record_serper_usage_records_a_serper_breakdown():
    with usage_accumulator_scope() as accumulator:
        breakdown = record_serper_usage(
            num_calls=2, route="rag", source="rag.web_search"
        )
        snapshot = accumulator.snapshot()

    assert breakdown is not None
    assert breakdown.provider == "serper"
    assert breakdown.cost_micros == 2_000
    assert breakdown.total_tokens == 0
    assert breakdown.is_estimated is False
    assert breakdown.route == "rag"
    assert breakdown.source == "rag.web_search"
    assert len(snapshot.breakdowns) == 1
    assert snapshot.cost_micros == 2_000


def test_record_serper_usage_with_no_calls_is_a_noop():
    with usage_accumulator_scope() as accumulator:
        result = record_serper_usage(num_calls=0, route="rag", source="rag.web_search")
        snapshot = accumulator.snapshot()

    assert result is None
    assert snapshot.breakdowns == []


def test_finance_turn_log_message_shows_total_and_serper_cost(caplog):
    import logging

    from api.rate_limiting.llm_usage import log_finance_turn_usage

    with usage_accumulator_scope():
        record_usage_breakdown(
            LLMUsageBreakdown(
                model="deepseek-v4-flash",
                prompt_tokens=100,
                completion_tokens=50,
                total_tokens=150,
                cached_tokens=0,
                cost_micros=10_000,
                is_estimated=False,
                route="finance",
                source="finance.answer",
            )
        )
        record_serper_usage(num_calls=2, route="finance", source="finance.web_search")
        with caplog.at_level(logging.INFO, logger="api.rate_limiting.llm_usage"):
            log_finance_turn_usage(prompt="tell me about helocs")

    messages = [
        record.getMessage()
        for record in caplog.records
        if "Route turn usage recorded" in record.getMessage()
    ]
    assert messages, "expected a route turn usage log line"
    message = messages[0]
    # The total ($0.010 OpenRouter + $0.002 Serper) and the per-provider split must
    # be in the message string, not just the dropped `extra` fields.
    assert "$0.012000" in message
    assert "serper=$0.002000" in message
    assert "openrouter=$0.010000" in message


def test_record_serper_usage_warns_when_no_accumulator_active(caplog):
    import logging

    # No usage_accumulator_scope: the cost would be silently dropped, so the
    # caller must at least get a warning that real Serper spend went unrecorded.
    with caplog.at_level(logging.WARNING):
        record_serper_usage(num_calls=2, route="rag", source="rag.web_search")

    assert any("accumulator" in record.message.lower() for record in caplog.records), (
        "expected a warning about the missing usage accumulator"
    )


def test_usage_log_rows_splits_openrouter_and_serper_into_two_rows():
    summary = _summary([_chat_breakdown(), _serper_breakdown()])

    rows = _usage_log_rows(
        usage_summary=summary,
        actual_cost_micros=12_000,
        normalized_model="deepseek-v4-flash",
        cost_is_overridden=False,
    )

    by_provider = {row["provider"]: row for row in rows}
    assert set(by_provider) == {"openrouter", "serper"}

    # Totals invariant: the split must sum back to the billed cost exactly.
    assert sum(row["cost_micros"] for row in rows) == 12_000

    primary = by_provider["openrouter"]
    assert primary["cost_micros"] == 10_000
    assert primary["total_tokens"] == 150
    assert primary["model"] == "deepseek-v4-flash"
    assert primary["source"] == "rag.rephraser"

    serper = by_provider["serper"]
    assert serper["cost_micros"] == 2_000
    assert serper["total_tokens"] == 0
    assert serper["model"] == "serper"
    assert serper["source"] == "rag.web_search"
    assert serper["is_estimated"] is False


def test_usage_log_rows_all_openrouter_stays_a_single_row():
    summary = _summary([_chat_breakdown(cost_micros=7_000)])

    rows = _usage_log_rows(
        usage_summary=summary,
        actual_cost_micros=7_000,
        normalized_model="deepseek-v4-flash",
        cost_is_overridden=False,
    )

    assert len(rows) == 1
    assert rows[0]["provider"] == "openrouter"
    assert rows[0]["cost_micros"] == 7_000


def test_usage_log_rows_without_breakdowns_is_a_single_estimated_row():
    rows = _usage_log_rows(
        usage_summary=None,
        actual_cost_micros=15_000,
        normalized_model="deepseek-v4-flash",
        cost_is_overridden=False,
    )

    assert len(rows) == 1
    assert rows[0]["provider"] == "openrouter"
    assert rows[0]["cost_micros"] == 15_000
    assert rows[0]["is_estimated"] is True


def test_usage_log_rows_does_not_split_when_cost_is_overridden():
    # When the cost is overridden (e.g. stream terminated early) it may not equal
    # the sum of breakdowns, so we must not split — keep the legacy single row.
    summary = _summary([_chat_breakdown(), _serper_breakdown()])

    rows = _usage_log_rows(
        usage_summary=summary,
        actual_cost_micros=3_333,
        normalized_model="deepseek-v4-flash",
        cost_is_overridden=True,
    )

    assert len(rows) == 1
    assert rows[0]["provider"] == "openrouter"
    assert rows[0]["cost_micros"] == 3_333


@pytest.mark.anyio
async def test_reservation_logs_serper_as_separate_provider_row(monkeypatch):
    """An end-to-end reservation persists Serper cost as its own ledger row."""
    set_upstash_client_for_testing(None)
    original_client = rl._upstash_client
    rl._upstash_client = None
    old_url = os.environ.pop("UPSTASH_REDIS_REST_URL", None)
    old_token = os.environ.pop("UPSTASH_REDIS_REST_TOKEN", None)

    logged = []
    monkeypatch.setattr(rl, "_fetch_config_from_db", lambda h: FAKE_CONFIG)
    monkeypatch.setattr(
        rl, "_log_usage_background", lambda *a, **kwargs: logged.append(kwargs)
    )

    try:
        with usage_accumulator_scope():
            async with reserve_llm_budget(
                api_key_hash=FAKE_HASH,
                route="rag",
                model="deepseek-v4-flash",
                request_id="req-serper",
            ):
                record_usage_breakdown(_chat_breakdown(cost_micros=10_000))
                record_serper_usage(num_calls=2, route="rag", source="rag.web_search")
    finally:
        rl._upstash_client = original_client
        if old_url:
            os.environ["UPSTASH_REDIS_REST_URL"] = old_url
        if old_token:
            os.environ["UPSTASH_REDIS_REST_TOKEN"] = old_token

    by_provider = {row["provider"]: row for row in logged}
    assert set(by_provider) == {"openrouter", "serper"}
    assert sum(row["cost_micros"] for row in logged) == 12_000

    serper = by_provider["serper"]
    assert serper["cost_micros"] == 2_000
    assert serper["route"] == "rag"
    assert serper["source"] == "rag.web_search"
    assert serper["model"] == "serper"
    assert serper["chat_usage_id"] == "ak-serper"
    assert serper["request_id"] == "req-serper"

    assert by_provider["openrouter"]["cost_micros"] == 10_000
