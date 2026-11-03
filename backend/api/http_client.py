"""Process-wide ``httpx.AsyncClient`` for outbound API calls.

Creating a client per request pays a fresh TCP + TLS handshake every time
(measured ~100ms vs ~25ms per Mapbox call). One pooled client keeps
connections alive across requests. Timeouts are passed per request.

The client is bound to the event loop that created it, so a different running
loop (e.g. per-test loops) gets its own client.
"""

from __future__ import annotations

import asyncio

import httpx

_client: httpx.AsyncClient | None = None
_client_loop: asyncio.AbstractEventLoop | None = None


def shared_async_client() -> httpx.AsyncClient:
    global _client, _client_loop
    loop = asyncio.get_running_loop()
    if _client is None or _client_loop is not loop:
        _client = httpx.AsyncClient()
        _client_loop = loop
    return _client


async def close_shared_async_client() -> None:
    global _client, _client_loop
    if _client is not None and _client_loop is asyncio.get_running_loop():
        await _client.aclose()
    _client = None
    _client_loop = None
