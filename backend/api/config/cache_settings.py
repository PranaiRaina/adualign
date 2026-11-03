"""Environment-backed settings for the optional Redis cache."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class CacheSettings(BaseSettings):
    """Cache-related settings loaded from the local environment."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    redis_enabled: bool = False
    redis_url: str | None = None
    upstash_redis_rest_url: str | None = None
    upstash_redis_rest_token: str | None = None
    redis_prefix: str = "plotalign"
    redis_read_timeout_ms: int = 1000
    redis_write_timeout_ms: int = 1000
    redis_ttl_parcel_seconds: int = 30 * 24 * 60 * 60
    redis_ttl_county_seconds: int = 30 * 24 * 60 * 60
    redis_ttl_fire_hazard_seconds: int = 30 * 24 * 60 * 60
    redis_ttl_recompute_seconds: int = 30 * 24 * 60 * 60


@lru_cache(maxsize=1)
def get_cache_settings() -> CacheSettings:
    """Return a process-wide settings snapshot for cache configuration."""
    return CacheSettings()
