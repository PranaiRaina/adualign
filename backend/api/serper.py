"""Shared Serper Google search client."""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

import httpx

from api.http_client import shared_async_client

logger = logging.getLogger(__name__)

SERPER_SEARCH_URL = "https://google.serper.dev/search"
DEFAULT_NUM_RESULTS = 3


def get_serper_api_key() -> str:
    return os.environ.get("SERPER_API_KEY", "").strip()


def parse_serper_organic(
    organic: list[dict[str, Any]], *, max_results: int
) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for item in organic[:max_results]:
        snippet = (item.get("snippet") or "").strip()
        if not snippet:
            continue
        results.append(
            {
                "title": item.get("title"),
                "url": item.get("link"),
                "content": snippet,
            }
        )
    return results


def search_serper_sync(
    *,
    api_key: str,
    query: str,
    num_results: int = DEFAULT_NUM_RESULTS,
    timeout: float = 30.0,
) -> dict[str, Any]:
    with httpx.Client(timeout=timeout) as client:
        response = client.post(
            SERPER_SEARCH_URL,
            headers={
                "X-API-KEY": api_key,
                "Content-Type": "application/json",
            },
            json={"q": query, "num": num_results},
        )
        response.raise_for_status()
        organic = response.json().get("organic") or []
        return {"results": parse_serper_organic(organic, max_results=num_results)}


async def search_serper_query(
    *,
    client: httpx.AsyncClient,
    api_key: str,
    query: str,
    num_results: int = DEFAULT_NUM_RESULTS,
) -> dict[str, Any]:
    response = await client.post(
        SERPER_SEARCH_URL,
        headers={
            "X-API-KEY": api_key,
            "Content-Type": "application/json",
        },
        json={"q": query, "num": num_results},
        timeout=30.0,
    )
    response.raise_for_status()
    organic = response.json().get("organic") or []
    return {"results": parse_serper_organic(organic, max_results=num_results)}


async def fetch_serper_results(
    *,
    api_key: str,
    queries: list[str],
    num_results: int = DEFAULT_NUM_RESULTS,
) -> list[dict[str, Any]]:
    if not queries:
        return []
    client = shared_async_client()
    search_tasks = [
        search_serper_query(
            client=client,
            api_key=api_key,
            query=query,
            num_results=num_results,
        )
        for query in queries
    ]
    results = await asyncio.gather(*search_tasks, return_exceptions=True)

    # Fail open per sub-query: one bad search must not kill the whole turn.
    # Cancellation, however, must propagate — it is not a sub-query failure.
    successful: list[dict[str, Any]] = []
    for query_index, result in enumerate(results):
        if isinstance(result, BaseException):
            if not isinstance(result, Exception):
                raise result  # CancelledError / KeyboardInterrupt — never swallow
            logger.warning(
                "Serper sub-query failed (query_index=%d): %s",
                query_index,
                result,
            )
            continue
        successful.append(result)
    return successful
