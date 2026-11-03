"""Shared test fixtures."""

import pytest
from langchain_openai.chat_models import _client_utils


@pytest.fixture(autouse=True)
def _reset_langchain_httpx_cache():
    """langchain-openai caches one async httpx client globally; pytest-asyncio
    gives each test its own event loop, so a later live test can close pooled
    connections created on an earlier, already-closed loop -> flaky
    "RuntimeError: Event loop is closed". Clear the cache so every test builds
    its client on its own loop."""
    # ponytail: private API; if an upgrade renames it this fails loudly at import.
    _client_utils._cached_async_httpx_client.cache_clear()
    yield


@pytest.fixture(autouse=True)
def _reset_signup_grant_cache():
    """The signup-grant cache is process-wide; tests reuse user ids across
    fresh databases, so start each test with it empty."""
    from api.authentication import auth

    auth._SIGNUP_GRANT_CONFIRMED.clear()
    yield


@pytest.fixture(autouse=True)
def _reset_shared_http_client():
    """Tests swap httpx.AsyncClient for fakes; never reuse a client across tests."""
    from api import http_client

    http_client._client = None
    http_client._client_loop = None
    yield
