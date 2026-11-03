"""Compare backend LLM usage logs against a LangSmith export.

Usage:
    uv run python scripts/audit_usage_vs_langsmith.py --langsmith path/to/export.jsonl
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

from langsmith import Client

# Add the project root to sys.path so we can import from 'api'
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from api.rate_limiting.llm_pricing import (
    SERPER_PROVIDER,
    compute_text_generation_cost_micros,
    normalize_generation_model,
)

REQUIRED_DB_ENV = "SUPABASE_DATABASE_URL"
DB_ENV_ALIASES = ("SUPABASE_DATABASE_URL", "SUPABASE_DB_URL", "DATABASE_URL")

# LangSmith only traces LLM calls, so external-API providers (e.g. Serper) have
# no LangSmith counterpart and must be excluded from the backend comparison.
NON_LLM_PROVIDERS = frozenset({SERPER_PROVIDER})


def load_langsmith_rows(path: Path) -> list[dict[str, Any]]:
    if path.suffix == ".jsonl":
        return [
            json.loads(line) for line in path.read_text().splitlines() if line.strip()
        ]
    if path.suffix == ".json":
        payload = json.loads(path.read_text())
        if isinstance(payload, list):
            return payload
        if isinstance(payload, dict):
            return payload.get("runs", [])
    if path.suffix == ".csv":
        with path.open() as handle:
            return list(csv.DictReader(handle))
    raise ValueError(f"Unsupported LangSmith export format: {path.suffix}")


def _find_request_id(value: Any) -> str | None:
    if isinstance(value, dict):
        request_id = value.get("request_id")
        if isinstance(request_id, str) and request_id:
            return request_id
        for nested in value.values():
            nested_request_id = _find_request_id(nested)
            if nested_request_id:
                return nested_request_id
    elif isinstance(value, list):
        for item in value:
            nested_request_id = _find_request_id(item)
            if nested_request_id:
                return nested_request_id
    return None


def extract_request_id(row: dict[str, Any]) -> str | None:
    for container in (row, row.get("metadata") or {}, row.get("extra") or {}):
        request_id = _find_request_id(container)
        if request_id:
            return request_id
    return None


def extract_usage_cost_micros(row: dict[str, Any]) -> int | None:
    outputs = row.get("outputs") or {}
    generations = outputs.get("generations")
    if not generations or not isinstance(generations, list) or not generations[0]:
        return None

    first_gen = generations[0][0]
    message_kwargs = first_gen.get("message", {}).get("kwargs", {})
    usage = message_kwargs.get("usage_metadata")
    if not usage:
        return None

    prompt_tokens = int(usage.get("input_tokens", usage.get("prompt_tokens", 0)) or 0)
    completion_tokens = int(
        usage.get("output_tokens", usage.get("completion_tokens", 0)) or 0
    )
    total_tokens = int(
        usage.get("total_tokens", prompt_tokens + completion_tokens) or 0
    )
    if total_tokens <= 0:
        return None

    input_details = (
        usage.get("input_token_details") or usage.get("prompt_tokens_details") or {}
    )
    cached_tokens = int(
        input_details.get("cache_read", input_details.get("cached_tokens", 0)) or 0
    )

    extra = row.get("extra", {}) or {}
    invocation_params = extra.get("invocation_params", {}) or {}
    model_name = invocation_params.get("model") or row.get("name")
    model = normalize_generation_model(model_name)

    return compute_text_generation_cost_micros(
        model, prompt_tokens, completion_tokens, cached_tokens
    )


def _aggregate_backend_rows(rows: Any) -> dict[str, dict[str, Any]]:
    """Group ChatUsageLog rows by request_id for the LangSmith comparison.

    A single reservation can persist several rows under one request_id (one per
    provider), so costs are summed rather than overwritten. External-API rows
    (e.g. Serper) are dropped because LangSmith never traces them.
    """
    grouped: dict[str, dict[str, Any]] = {}
    for row in rows:
        if row.provider in NON_LLM_PROVIDERS:
            continue
        request_id = str(row.request_id)
        entry = grouped.get(request_id)
        if entry is None:
            grouped[request_id] = {
                "request_id": request_id,
                "cost_micros": int(row.cost_micros or 0),
                "is_estimated": bool(row.is_estimated),
                "route": row.route,
                "model": row.model,
            }
        else:
            entry["cost_micros"] += int(row.cost_micros or 0)
            entry["is_estimated"] = entry["is_estimated"] or bool(row.is_estimated)
    return grouped


def load_backend_usage(start_time: datetime | None = None) -> dict[str, dict[str, Any]]:
    from api.database.core import SessionLocal
    from api.database.models import ChatUsageLog

    with SessionLocal() as db:
        query = db.query(ChatUsageLog)
        if start_time:
            query = query.filter(ChatUsageLog.created_at >= start_time)
        rows = query.all()

    return _aggregate_backend_rows(rows)


def summarize_drift(
    *,
    backend_rows: dict[str, dict[str, Any]],
    langsmith_rows: list[dict[str, Any]],
) -> None:
    # We aggregate since LangChain doesn't log our internal request_id
    backend_total_micros = sum(
        row["cost_micros"] for row in backend_rows.values() if not row["is_estimated"]
    )
    langsmith_total_micros = sum(
        (extract_usage_cost_micros(row) or 0) for row in langsmith_rows
    )

    baseline = max(langsmith_total_micros, 1)
    drift = abs(backend_total_micros - langsmith_total_micros) / baseline

    estimated_rows = sum(1 for row in backend_rows.values() if row["is_estimated"])

    print("Backend vs LangSmith audit")
    print(f"Total LangSmith tracked cost: ${langsmith_total_micros / 1_000_000:.6f}")
    print(f"Total Backend measured cost:  ${backend_total_micros / 1_000_000:.6f}")
    print(f"Excluded estimated requests: {estimated_rows}")
    print(f"Overall drift: {drift:.2%}")
    print("Strict drift target for non-estimated requests: <= 5%")


def _configure_database_env() -> None:
    from dotenv import load_dotenv

    explicit_required_url = os.getenv(REQUIRED_DB_ENV)
    explicit_legacy_url = os.getenv("DATABASE_URL") or os.getenv("SUPABASE_DB_URL")

    load_dotenv(Path(__file__).resolve().parent.parent / ".env")

    configured_url = (
        explicit_required_url
        or explicit_legacy_url
        or next(
            (os.getenv(name) for name in DB_ENV_ALIASES if os.getenv(name)),
            None,
        )
    )
    if not configured_url:
        alias_list = ", ".join(DB_ENV_ALIASES)
        raise RuntimeError(
            "Database environment variables are not configured. "
            f"Expected one of: {alias_list}"
        )

    os.environ[REQUIRED_DB_ENV] = configured_url


def fetch_langsmith_runs(minutes: int) -> list[dict[str, Any]]:
    client = Client()
    project_name = os.environ.get("LANGCHAIN_PROJECT")
    print(
        f"Fetching LangSmith runs for project: {project_name} (last {minutes} minutes)..."
    )
    start_time = datetime.now(timezone.utc) - timedelta(minutes=minutes)
    runs = list(
        client.list_runs(
            project_name=project_name, run_type="llm", start_time=start_time
        )
    )

    export_data = []
    for run in runs:
        export_data.append(
            {
                "id": str(run.id),
                "name": run.name,
                "outputs": run.outputs,
                "extra": run.extra,
                "start_time": run.start_time.isoformat() if run.start_time else None,
            }
        )
    return export_data


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--langsmith", type=Path, help="Path to local LangSmith export JSON/JSONL"
    )
    parser.add_argument(
        "--minutes",
        type=int,
        help="Fetch directly from LangSmith API for the last N minutes",
    )
    args = parser.parse_args()

    if not args.langsmith and not args.minutes:
        parser.error("Must provide either --langsmith or --minutes")

    _configure_database_env()

    start_time = None
    if args.minutes:
        start_time = datetime.now(timezone.utc) - timedelta(minutes=args.minutes)
        langsmith_rows = fetch_langsmith_runs(args.minutes)
    else:
        langsmith_rows = load_langsmith_rows(args.langsmith)

    backend_rows = load_backend_usage(start_time=start_time)
    summarize_drift(backend_rows=backend_rows, langsmith_rows=langsmith_rows)


if __name__ == "__main__":
    main()
