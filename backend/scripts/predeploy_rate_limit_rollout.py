"""Predeploy normalization for the rate-limit rollout."""

from __future__ import annotations

import argparse
import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine

from api.database.rate_limit_rollout import (
    RateLimitRolloutSummary,
    apply_rate_limit_rollout_predeploy_to_engine,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Normalize rate-limit rollout data before deployment.",
    )
    parser.add_argument(
        "--default-budget-micros",
        type=int,
        default=10_000_000,
        help="Positive budget to backfill into chat_usage rows with NULL budget_micros.",
    )
    return parser


def format_summary(summary: RateLimitRolloutSummary) -> str:
    return "\n".join(
        [
            "Rate-limit rollout predeploy complete.",
            f"default_budget_micros={summary.default_budget_micros}",
            f"null_budget_rows_before={summary.null_budget_rows_before}",
            f"null_budget_rows_backfilled={summary.null_budget_rows_backfilled}",
            "active_keys_migrated_to_lifetime="
            f"{summary.active_keys_migrated_to_lifetime}",
            "duplicate_active_keys_deactivated="
            f"{summary.duplicate_active_keys_deactivated}",
            f"null_budget_rows_after={summary.null_budget_rows_after}",
        ]
    )


def main() -> int:
    _load_backend_env()
    args = build_parser().parse_args()
    engine = create_engine(
        _load_database_url(), pool_pre_ping=True, pool_size=10, max_overflow=20
    )
    summary = apply_rate_limit_rollout_predeploy_to_engine(
        engine,
        default_budget_micros=args.default_budget_micros,
    )
    print(format_summary(summary))
    return 0


def _load_database_url() -> str:
    _load_backend_env()
    database_url = os.getenv("SUPABASE_DATABASE_URL")
    if not database_url:
        raise RuntimeError(
            "SUPABASE_DATABASE_URL not set in environment. Production database required."
        )
    if database_url.startswith("postgres://"):
        return database_url.replace("postgres://", "postgresql://", 1)
    return database_url


def _load_backend_env() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    backend_env = repo_root / ".env"
    if backend_env.exists():
        load_dotenv(backend_env, override=False)


if __name__ == "__main__":
    raise SystemExit(main())
