import logging

import pytest

from api.cache.redis_cache import RedisJsonCache


class FakeRedisClient:
    def __init__(self, raw=None, get_error: Exception | None = None) -> None:
        self.raw = raw
        self.get_error = get_error
        self.get_calls: list[str] = []
        self.set_calls: list[dict] = []

    async def get(self, key: str):
        self.get_calls.append(key)
        if self.get_error is not None:
            raise self.get_error
        return self.raw

    async def set(self, key: str, value: str, *, ex: int) -> None:
        self.set_calls.append({"key": key, "value": value, "ex": ex})


class FailingSetRedisClient(FakeRedisClient):
    async def set(self, key: str, value: str, *, ex: int) -> None:
        raise RuntimeError("write failed")


class _TestableRedisJsonCache(RedisJsonCache):
    def __init__(
        self,
        *,
        redis_client: FakeRedisClient | None = None,
        upstash_client: FakeRedisClient | None = None,
        enabled: bool = False,
        url: str | None = None,
        upstash_rest_url: str | None = None,
        upstash_rest_token: str | None = None,
    ) -> None:
        super().__init__(
            enabled=enabled,
            url=url,
            upstash_rest_url=upstash_rest_url,
            upstash_rest_token=upstash_rest_token,
            read_timeout_ms=200,
            write_timeout_ms=350,
        )
        self.redis_client = redis_client or FakeRedisClient()
        self.upstash_client = upstash_client or FakeRedisClient()

    def _create_redis_client(self):
        return self.redis_client

    def _create_upstash_client(self):
        return self.upstash_client


@pytest.mark.anyio
async def test_upstash_backend_is_preferred_when_configured(caplog):
    redis_client = FakeRedisClient()
    upstash_client = FakeRedisClient(raw='{"value":1}')
    cache = _TestableRedisJsonCache(
        enabled=True,
        url="redis://localhost:6379/0",
        upstash_rest_url="https://example.upstash.io",
        upstash_rest_token="token",
        redis_client=redis_client,
        upstash_client=upstash_client,
    )

    assert cache.configured_backend == "upstash"
    with caplog.at_level(logging.INFO):
        assert await cache.get_json("cache-key", resource="parcel") == {"value": 1}
    await cache.set_json("cache-key", {"value": 2}, ttl_seconds=30, resource="parcel")

    assert upstash_client.get_calls == ["cache-key"]
    assert upstash_client.set_calls == [
        {"key": "cache-key", "value": '{"value":2}', "ex": 30}
    ]
    assert redis_client.get_calls == []
    assert redis_client.set_calls == []
    assert any(
        record.message.startswith("Map cache Upstash Redis client initialized")
        and record.backend == "upstash"
        for record in caplog.records
    )


@pytest.mark.anyio
async def test_local_redis_backend_is_used_when_upstash_is_absent(caplog):
    redis_client = FakeRedisClient(raw='{"county":"Orange County"}')
    cache = _TestableRedisJsonCache(
        enabled=True,
        url="redis://localhost:6379/0",
        redis_client=redis_client,
    )

    assert cache.configured_backend == "redis"
    with caplog.at_level(logging.INFO):
        assert await cache.get_json("county-key", resource="county") == {
            "county": "Orange County"
        }
    assert any(
        record.message.startswith("Map cache local Redis fallback client initialized")
        and record.backend == "redis"
        for record in caplog.records
    )


@pytest.mark.anyio
async def test_disabled_cache_returns_miss_without_backend_calls():
    redis_client = FakeRedisClient(raw='{"value":1}')
    cache = _TestableRedisJsonCache(redis_client=redis_client)

    assert cache.configured_backend == "disabled"
    assert await cache.get_json("cache-key", resource="parcel") is None
    await cache.set_json("cache-key", {"value": 2}, ttl_seconds=30, resource="parcel")
    assert redis_client.get_calls == []
    assert redis_client.set_calls == []


@pytest.mark.anyio
async def test_malformed_json_fails_open():
    cache = _TestableRedisJsonCache(
        enabled=True,
        url="redis://localhost:6379/0",
        redis_client=FakeRedisClient(raw="{not-json"),
    )

    assert await cache.get_json("cache-key", resource="parcel") is None


@pytest.mark.anyio
async def test_read_errors_fail_open():
    cache = _TestableRedisJsonCache(
        enabled=True,
        url="redis://localhost:6379/0",
        redis_client=FakeRedisClient(get_error=RuntimeError("read failed")),
    )

    assert await cache.get_json("cache-key", resource="parcel") is None


@pytest.mark.anyio
async def test_write_errors_fail_open():
    cache = _TestableRedisJsonCache(
        enabled=True,
        url="redis://localhost:6379/0",
        redis_client=FailingSetRedisClient(),
    )

    await cache.set_json("cache-key", {"value": 2}, ttl_seconds=30, resource="parcel")
