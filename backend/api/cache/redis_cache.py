"""Small fail-open Redis JSON cache used by the map endpoints."""

import asyncio
import json
import logging
from time import perf_counter
from typing import Any, Literal

from redis import asyncio as redis_asyncio
from redis.exceptions import RedisError

from api.config.cache_settings import get_cache_settings


logger = logging.getLogger(__name__)

_CACHE_NAMESPACE = "map"
_CACHE_LOG_TEMPLATE = "cache_event event=%s operation=%s resource=%s namespace=%s"
_CACHE_ERROR_LOG_TEMPLATE = (
    "cache_event event=%s operation=%s resource=%s namespace=%s reason=%s"
)
CacheBackend = Literal["upstash", "redis", "disabled"]
CacheOperation = Literal["read", "write"]
_BACKEND_LABELS: dict[CacheBackend, str] = {
    "upstash": "Upstash Redis",
    "redis": "local Redis fallback",
    "disabled": "disabled",
}


class RedisJsonCache:
    """Async JSON cache with short deadlines and fail-open semantics."""

    def __init__(
        self,
        *,
        enabled: bool,
        url: str | None,
        upstash_rest_url: str | None,
        upstash_rest_token: str | None,
        read_timeout_ms: int,
        write_timeout_ms: int,
    ) -> None:
        self._redis_enabled = enabled and bool(url)
        self._url = url
        self._upstash_rest_url = upstash_rest_url
        self._upstash_rest_token = upstash_rest_token
        self._read_timeout_ms = read_timeout_ms
        self._write_timeout_ms = write_timeout_ms
        self._redis_client: redis_asyncio.Redis | None = None
        self._upstash_client: Any | None = None

    @property
    def configured_backend(self) -> CacheBackend:
        """Return the selected cache backend without opening a connection."""
        if self._upstash_rest_url and self._upstash_rest_token:
            return "upstash"
        if self._redis_enabled and self._url:
            return "redis"
        return "disabled"

    def _log_event(
        self,
        event: str,
        operation: CacheOperation,
        resource: str,
        exc: Exception | None = None,
    ) -> None:
        extra = {
            "event": event,
            "operation": operation,
            "resource": resource,
            "namespace": _CACHE_NAMESPACE,
        }
        if exc is None:
            logger.info(
                _CACHE_LOG_TEMPLATE,
                event,
                operation,
                resource,
                _CACHE_NAMESPACE,
                extra=extra,
            )
            return
        logger.warning(
            _CACHE_ERROR_LOG_TEMPLATE,
            event,
            operation,
            resource,
            _CACHE_NAMESPACE,
            self._format_error_reason(exc),
            extra=extra,
        )

    @staticmethod
    def _format_error_reason(exc: Exception) -> str:
        if isinstance(exc, TimeoutError | asyncio.TimeoutError):
            return "timeout"
        if isinstance(exc, RedisError):
            message = str(exc).strip()
            return message if message else exc.__class__.__name__
        return exc.__class__.__name__

    def _create_upstash_client(self) -> Any:
        if self._upstash_rest_url is None or self._upstash_rest_token is None:
            raise ValueError("Upstash URL and token are required for the cache backend")
        from upstash_redis.asyncio import Redis as UpstashRedis

        return UpstashRedis(
            url=self._upstash_rest_url,
            token=self._upstash_rest_token,
        )

    def _create_redis_client(self) -> redis_asyncio.Redis:
        if self._url is None:
            raise ValueError("Redis URL is required for the redis cache backend")
        return redis_asyncio.from_url(
            self._url,
            encoding="utf-8",
            decode_responses=True,
        )

    async def _get_client(self) -> Any | None:
        backend = self.configured_backend
        if backend == "upstash":
            if self._upstash_client is None:
                started_at = perf_counter()
                self._upstash_client = self._create_upstash_client()
                self._log_client_initialized(backend, started_at)
            return self._upstash_client
        if backend == "redis":
            if self._redis_client is None:
                started_at = perf_counter()
                self._redis_client = self._create_redis_client()
                self._log_client_initialized(backend, started_at)
            return self._redis_client
        return None

    def _log_client_initialized(
        self,
        backend: CacheBackend,
        started_at: float,
    ) -> None:
        elapsed_ms = (perf_counter() - started_at) * 1000
        logger.info(
            "Map cache %s client initialized in %.1fms",
            _BACKEND_LABELS[backend],
            elapsed_ms,
            extra={
                "backend": backend,
                "namespace": _CACHE_NAMESPACE,
                "elapsed_ms": round(elapsed_ms, 1),
            },
        )

    async def get_json(self, key: str, *, resource: str) -> dict[str, Any] | None:
        """Return cached JSON payload or ``None`` on miss or cache failure."""
        client = await self._get_client()
        if client is None:
            return None
        try:
            raw = await asyncio.wait_for(
                client.get(key),
                timeout=self._read_timeout_ms / 1000,
            )
        except Exception as exc:
            self._log_event("cache_error", "read", resource, exc)
            return None
        if raw is None:
            self._log_event("cache_miss", "read", resource)
            return None
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError as exc:
            self._log_event("cache_error", "read", resource, exc)
            return None
        self._log_event("cache_hit", "read", resource)
        return payload

    async def set_json(
        self,
        key: str,
        value: dict[str, Any],
        *,
        ttl_seconds: int,
        resource: str,
    ) -> None:
        """Store a JSON payload with TTL, ignoring cache failures."""
        client = await self._get_client()
        if client is None:
            return
        try:
            payload = json.dumps(value, separators=(",", ":"), sort_keys=True)
            await asyncio.wait_for(
                client.set(key, payload, ex=ttl_seconds),
                timeout=self._write_timeout_ms / 1000,
            )
        except Exception as exc:
            self._log_event("cache_error", "write", resource, exc)
            return
        self._log_event("cache_write", "write", resource)


_cache_instance: RedisJsonCache | None = None


def get_cache() -> RedisJsonCache:
    """Return the shared cache instance used across map requests."""
    global _cache_instance
    if _cache_instance is None:
        settings = get_cache_settings()
        _cache_instance = RedisJsonCache(
            enabled=settings.redis_enabled,
            url=settings.redis_url,
            upstash_rest_url=settings.upstash_redis_rest_url,
            upstash_rest_token=settings.upstash_redis_rest_token,
            read_timeout_ms=settings.redis_read_timeout_ms,
            write_timeout_ms=settings.redis_write_timeout_ms,
        )
        backend = _cache_instance.configured_backend
        logger.info(
            "Map cache backend selected: %s",
            _BACKEND_LABELS[backend],
            extra={"backend": backend, "namespace": _CACHE_NAMESPACE},
        )
    return _cache_instance


def set_cache_for_testing(cache: RedisJsonCache | None) -> None:
    """Override the shared cache instance in tests."""
    global _cache_instance
    _cache_instance = cache
