"""Benchmark DB round trips on the auth and map-search credit hot paths.

Runs the real code paths (``resolve_current_user_from_token`` and
``reserve_map_search_charge``) with the app's production engine settings
against a local Postgres, through an in-process TCP proxy that adds network
latency so round-trip savings show up the way they do against a remote DB.

Never point this at a production database: it creates bench users and
credits. Use a disposable Postgres with the app schema applied, e.g.:

    docker run -d --name bench-pg -e POSTGRES_PASSWORD=postgres \\
        -p 55432:5432 pgvector/pgvector:pg16
    psql ... -f docs/db_schema.github_actions.sql
    SUPABASE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/postgres \\
        uv run python scripts/migrate.py
    uv run python scripts/bench_db_hot_paths.py \\
        --db postgresql://postgres:postgres@127.0.0.1:55432/postgres --rtt-ms 0 2 20
"""

from __future__ import annotations

import argparse
import asyncio
import os
import socket
import statistics
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Callable
from unittest.mock import patch
from urllib.parse import urlsplit, urlunsplit


class LatencyProxy:
    """TCP proxy adding ``rtt_ms / 2`` one-way delay in each direction."""

    def __init__(self, target_host: str, target_port: int, rtt_ms: float) -> None:
        self.target = (target_host, target_port)
        self.one_way_s = rtt_ms / 2000
        sock = socket.socket()
        sock.bind(("127.0.0.1", 0))
        self.port = sock.getsockname()[1]
        sock.close()
        self._loop = asyncio.new_event_loop()
        ready = threading.Event()
        threading.Thread(target=self._run, args=(ready,), daemon=True).start()
        ready.wait()

    def _run(self, ready: threading.Event) -> None:
        asyncio.set_event_loop(self._loop)
        server = self._loop.run_until_complete(
            asyncio.start_server(self._handle, "127.0.0.1", self.port)
        )
        ready.set()
        self._loop.run_until_complete(server.serve_forever())

    async def _handle(self, client_r, client_w) -> None:
        upstream_r, upstream_w = await asyncio.open_connection(*self.target)
        await asyncio.gather(
            self._pipe(client_r, upstream_w), self._pipe(upstream_r, client_w)
        )

    async def _pipe(self, reader, writer) -> None:
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue = asyncio.Queue()

        async def sender() -> None:
            while True:
                sent_at, data = await queue.get()
                if data is None:
                    writer.close()
                    return
                wait = sent_at + self.one_way_s - loop.time()
                if wait > 0:
                    await asyncio.sleep(wait)
                writer.write(data)
                await writer.drain()

        task = asyncio.create_task(sender())
        try:
            while data := await reader.read(65536):
                queue.put_nowait((loop.time(), data))
        except ConnectionError:
            pass
        queue.put_nowait((0.0, None))
        await task


def _percentiles(samples: list[float]) -> str:
    ordered = sorted(samples)
    p95 = ordered[min(len(ordered) - 1, int(0.95 * len(ordered)))]
    return f"median={statistics.median(ordered):7.1f}ms  p95={p95:7.1f}ms"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--db", required=True, help="disposable Postgres URL")
    parser.add_argument("--rtt-ms", type=float, nargs="+", default=[0, 2, 20])
    parser.add_argument("-n", type=int, default=50)
    parser.add_argument("--workers", type=int, default=20)
    parser.add_argument("--throughput-seconds", type=float, default=5.0)
    args = parser.parse_args()

    target = urlsplit(args.db)
    if target.hostname not in {"127.0.0.1", "localhost"}:
        raise SystemExit("Refusing to benchmark a non-local database.")

    for rtt in args.rtt_ms:
        proxy = LatencyProxy(target.hostname, target.port or 5432, rtt)
        netloc = f"{target.username}:{target.password}@127.0.0.1:{proxy.port}"
        os.environ["SUPABASE_DATABASE_URL"] = urlunsplit(target._replace(netloc=netloc))
        _bench_at_rtt(rtt, args)


def _bench_at_rtt(rtt: float, args: argparse.Namespace) -> None:
    import importlib

    from sqlalchemy import event

    import api.database.core as core

    core = importlib.reload(core)  # production engine settings, proxied URL
    from api.authentication import auth
    from api.database.models import User
    from api.database.repository import (
        SERVICE_TYPE_ADDRESS_ACCESS,
        ServiceCreditRepository,
    )
    from api.rate_limiting import map_search_usage

    map_search_usage.SessionLocal = core.SessionLocal
    getattr(auth, "_SIGNUP_GRANT_CONFIRMED", set()).clear()  # absent pre-change

    statements = threading.local()

    @event.listens_for(core.engine, "before_cursor_execute")
    def _count(*_a) -> None:
        statements.n = getattr(statements, "n", 0) + 1

    def make_user() -> str:
        uid = f"bench-{uuid.uuid4()}"
        with core.SessionLocal() as db:
            db.add(User(id=uid, email=f"{uid}@bench.local", name="Bench"))
            db.commit()
            ServiceCreditRepository.grant_signup_credits(db, user_id=uid)
            ServiceCreditRepository.grant_credits(
                db,
                user_id=uid,
                service_type=SERVICE_TYPE_ADDRESS_ACCESS,
                amount=1_000_000,
                reason="purchase",
                actor_type="system",
                idempotency_key=f"bench-topup:{uid}",
            )
        return uid

    def auth_request(uid: str) -> None:
        claims = type("Claims", (), {"user_id": uid})()
        with patch.object(auth, "verify_supabase_access_token", return_value=claims):
            db = core.SessionLocal()
            try:
                auth.resolve_current_user_from_token("bench-token", db)
            finally:
                db.close()

    def debit_request(uid: str) -> None:
        map_search_usage.reserve_map_search_charge(
            user_id=uid, project_id=None, map_search_id=str(uuid.uuid4())
        )

    def timed(fn: Callable[[], None]) -> tuple[list[float], float]:
        fn()  # warm-up: pool connection, signup-grant cache
        samples, counts = [], []
        for _ in range(args.n):
            statements.n = 0
            start = time.perf_counter()
            fn()
            samples.append((time.perf_counter() - start) * 1000)
            counts.append(statements.n)
        return samples, statistics.mean(counts)

    uid = make_user()
    print(f"\n=== simulated network RTT {rtt:g} ms ===")
    for label, fn in (
        ("auth (every request)", lambda: auth_request(uid)),
        ("map-search debit", lambda: debit_request(uid)),
    ):
        samples, stmts = timed(fn)
        print(f"{label:22s} {_percentiles(samples)}  statements={stmts:.0f}")

    users = [make_user() for _ in range(args.workers)]
    for label, pick in (
        ("debit throughput, distinct users", lambda i: users[i]),
        ("debit throughput, one hot user", lambda i: users[0]),
    ):
        stop_at = time.perf_counter() + args.throughput_seconds
        done = [0] * args.workers

        def worker(i: int) -> None:
            while time.perf_counter() < stop_at:
                debit_request(pick(i))
                done[i] += 1

        with ThreadPoolExecutor(args.workers) as pool:
            list(pool.map(worker, range(args.workers)))
        rate = sum(done) / args.throughput_seconds
        print(f"{label:34s} {rate:8.0f} debits/s ({args.workers} workers)")

    core.engine.dispose()


if __name__ == "__main__":
    main()
