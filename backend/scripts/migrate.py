"""One-shot database schema migration entrypoint.

Run this ONCE per deploy (and manually in dev), BEFORE starting the app:

    uv run python scripts/migrate.py

This replaces the old behavior of calling ensure_database_schema() from the
FastAPI startup handler. Running it on every boot raced across replicas (the
table rename and data backfills are not concurrency-safe) and coupled every
deploy to a migration. As a single one-shot command it runs exactly once and
is decoupled from app startup.

Importing api.database.core loads the backend .env and builds the engine, so
no extra configuration is required here.
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path

# Ensure the backend repo root is importable when this file is run directly
# (`python scripts/migrate.py` puts scripts/ on sys.path, not the repo root).
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from api.database.core import ensure_database_schema  # noqa: E402

logger = logging.getLogger(__name__)


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    logger.info("Applying database schema (ensure_database_schema)...")
    try:
        ensure_database_schema()
    except Exception:
        logger.exception("Database schema migration failed.")
        return 1
    logger.info("Database schema migration complete.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
