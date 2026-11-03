"""Profile the real streaming chat endpoint (/agent/orchestrate/stream).

Calls ``orchestrate_stream`` in-process and timestamps the SSE bytes it
produces: TTFB (response returned), first status event, first answer token
(TTFT) and stream end. Uses live LLM/embedding/search APIs (~$0.005 per
question on deepseek-v4-flash) and read-only pgvector retrieval. Auth, API-key
provisioning and budget config lookups are stubbed and Upstash is disabled,
so nothing is written to the database or Redis.

    UPSTASH_REDIS_REST_URL= UPSTASH_REDIS_REST_TOKEN= LANGCHAIN_TRACING_V2=false \\
        uv run python scripts/profile_chat_pipeline.py -n 3
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import statistics
import time
from unittest.mock import patch

from api.database.models import User
from api.rate_limiting import rate_limiter
from orchestrator import router
from orchestrator.schemas import OrchestratorRequest

QUESTIONS = [
    "What is the maximum height allowed for a detached ADU in California?",
    "Do I need to provide parking for an ADU near public transit?",
    "Can I rent out my ADU as a short-term rental in Irvine?",
]


async def profile_once(question: str) -> dict[str, float]:
    user = User(id="profile-user", email="profile@example.com", name="Profile")
    req = OrchestratorRequest(message=question, county="Orange County")
    marks: dict[str, float] = {}
    start = time.perf_counter()

    def mark(name: str) -> None:
        marks.setdefault(name, (time.perf_counter() - start) * 1000)

    with (
        patch.object(router, "ensure_user_api_key", lambda _uid: "profile-hash"),
        patch.object(rate_limiter, "fetch_api_key_config", lambda _hash: None),
    ):
        response = await router.orchestrate_stream(req, current_user=user)
        mark("TTFB")
        async for raw in response.body_iterator:
            chunk = raw.decode() if isinstance(raw, bytes) else raw
            if "Searching the web" in chunk:
                marks["web_search"] = 1.0
            if "Writing answer" in chunk:
                mark("gen_start")
            if chunk.startswith("event: status"):
                mark("first_status")
            elif chunk.startswith('data: {"text"'):
                mark("TTFT")
        mark("done")
    marks.setdefault("web_search", 0.0)
    return marks


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("-n", type=int, default=3, help="runs per question")
    args = parser.parse_args()
    logging.disable(logging.WARNING)

    async def run() -> None:
        ttfb, gen_start, ttft, done = [], [], [], []
        for question in QUESTIONS:
            for _ in range(args.n):
                m = await profile_once(question)
                ttfb.append(m["TTFB"])
                gen_start.append(m["gen_start"])
                ttft.append(m["TTFT"])
                done.append(m["done"])
                print(
                    f"{question[:44]:44s} TTFB={m['TTFB']:6.0f}ms "
                    f"gen_start={m['gen_start']:6.0f}ms "
                    f"TTFT={m['TTFT']:6.0f}ms done={m['done']:6.0f}ms "
                    f"web={'y' if m['web_search'] else 'n'}",
                    flush=True,
                )
        for name, xs in (
            ("TTFB", ttfb),
            ("gen_start", gen_start),
            ("TTFT", ttft),
            ("done", done),
        ):
            xs.sort()
            print(
                f"{name:9s} median={statistics.median(xs):6.0f}ms "
                f"p90={xs[int(0.9 * (len(xs) - 1))]:6.0f}ms  (n={len(xs)})"
            )

    asyncio.run(run())


if __name__ == "__main__":
    main()
