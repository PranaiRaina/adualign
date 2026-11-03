"""Benchmark /analyze end-to-end latency against live cache/geocoding services.

Calls the real ``analyze_property`` handler in-process (no HTTP, no auth) with
real Upstash and Mapbox I/O. No ``map_search_id`` is sent, so no address
credits are charged and the database is never touched.

The parcel at --lat/--lng must already be in the parcel cache (search it once in
the app first); the script aborts instead of making paid ReportAll calls.

Scenarios:
  warm         parcel + county both served from the Redis cache
  cold-county  parcel cached, county cache forced to miss (live Mapbox call)

Run on two checkouts to compare, e.g.:
    SUPABASE_DATABASE_URL=postgresql://none:none@127.0.0.1:1/none \\
        uv run python scripts/bench_analyze.py --lat 33.68 --lng -117.80 -n 40
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import statistics
import time

from api import main
from api.database.models import User
from api.schemas import AnalyzeRequest
from engine import geocoding, parcel


async def _require_cached_parcel(cache_key: str):
    cached = await _original_get_cached_parcel(cache_key)
    if cached is None:
        raise SystemExit(
            "Parcel is not cached at these coordinates; search it in the app first "
            "(refusing to make paid ReportAll calls)."
        )
    return cached


async def _always_miss(_cache_key: str) -> None:
    return None


async def _noop_write(*_args, **_kwargs) -> None:
    return None


_original_get_cached_parcel = parcel._get_cached_parcel_base


async def _run(lat: float, lng: float, n: int, scenario: str) -> list[float]:
    parcel._get_cached_parcel_base = _require_cached_parcel
    if scenario == "cold-county":
        geocoding._get_cached_county = _always_miss
        geocoding._cache_county = _noop_write

    request = AnalyzeRequest(
        lat=lat, lng=lng, location="irvine_ca", building_footprints=[]
    )
    user = User(id="bench-user", email="bench@example.com", name="Bench")

    await main.analyze_property(request, current_user=user)  # warm-up
    samples = []
    for _ in range(n):
        start = time.perf_counter()
        await main.analyze_property(request, current_user=user)
        samples.append((time.perf_counter() - start) * 1000)
    return samples


def _summary(samples: list[float]) -> str:
    ordered = sorted(samples)
    p95 = ordered[min(len(ordered) - 1, int(0.95 * len(ordered)))]
    return (
        f"n={len(ordered)} median={statistics.median(ordered):.0f}ms "
        f"p95={p95:.0f}ms min={ordered[0]:.0f}ms"
    )


def main_cli() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--lat", type=float, required=True)
    parser.add_argument("--lng", type=float, required=True)
    parser.add_argument("-n", type=int, default=40)
    parser.add_argument(
        "--scenario", choices=["warm", "cold-county", "both"], default="both"
    )
    args = parser.parse_args()
    logging.disable(logging.WARNING)

    # Warm runs first: cold-county patches the county cache for the rest of
    # the process. One event loop, since the async cache client is loop-bound.
    scenarios = ["warm", "cold-county"] if args.scenario == "both" else [args.scenario]

    async def _all() -> None:
        for scenario in scenarios:
            samples = await _run(args.lat, args.lng, args.n, scenario)
            print(f"{scenario:12s} {_summary(samples)}")

    asyncio.run(_all())


if __name__ == "__main__":
    main_cli()
