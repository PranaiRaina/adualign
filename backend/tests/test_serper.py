"""Resilience tests for the shared Serper search client."""

from __future__ import annotations

import asyncio

import httpx
import pytest

from api import serper


async def test_fetch_serper_results_skips_failed_subqueries(monkeypatch):
    """One failing sub-query must not kill the whole batch."""

    async def fake_search(*, client, api_key, query, num_results):
        if query == "bad":
            raise httpx.HTTPError("sub-query failed")
        return {"results": [{"title": query, "url": "u", "content": "c"}]}

    monkeypatch.setattr(serper, "search_serper_query", fake_search)

    out = await serper.fetch_serper_results(
        api_key="k", queries=["good1", "bad", "good2"]
    )

    # The bad sub-query is dropped; the good ones survive, in order.
    assert [r["results"][0]["title"] for r in out] == ["good1", "good2"]


async def test_fetch_serper_results_returns_empty_when_all_subqueries_fail(monkeypatch):
    async def fake_search(*, client, api_key, query, num_results):
        raise httpx.ConnectError("serper down")

    monkeypatch.setattr(serper, "search_serper_query", fake_search)

    out = await serper.fetch_serper_results(api_key="k", queries=["a", "b"])
    assert out == []


async def test_fetch_serper_results_propagates_cancellation(monkeypatch):
    """Cancellation must propagate, not be swallowed as a failed sub-query."""

    async def fake_search(*, client, api_key, query, num_results):
        if query == "cancelled":
            raise asyncio.CancelledError()
        return {"results": [{"title": query}]}

    monkeypatch.setattr(serper, "search_serper_query", fake_search)
    with pytest.raises(asyncio.CancelledError):
        await serper.fetch_serper_results(api_key="k", queries=["good", "cancelled"])


async def test_fetch_serper_results_all_success_preserves_order(monkeypatch):
    async def fake_search(*, client, api_key, query, num_results):
        return {"results": [{"title": query}]}

    monkeypatch.setattr(serper, "search_serper_query", fake_search)

    out = await serper.fetch_serper_results(api_key="k", queries=["a", "b", "c"])
    assert [r["results"][0]["title"] for r in out] == ["a", "b", "c"]
