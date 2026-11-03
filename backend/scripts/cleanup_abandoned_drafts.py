"""Delete abandoned project shells.

Click-created "Plan your ADU" projects are persisted with status="project" before
any report, finance state, or meaningful report preload exists. When a user
abandons the flow these empty shells accumulate. This script removes drafts that
are older than a configured age and still have no report, no draft listing, no
finance state, and no meaningful report preload.

Usage:
    python -m scripts.cleanup_abandoned_drafts [--max-age-hours 24] [--dry-run]
"""

from __future__ import annotations

import argparse
import datetime
import logging

from api.database.core import SessionLocal
from api.database.models import Project
from api.database.repository import ReportRepository

logger = logging.getLogger("cleanup_abandoned_drafts")

DEFAULT_MAX_AGE_HOURS = 24


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--max-age-hours",
        type=float,
        default=DEFAULT_MAX_AGE_HOURS,
        help="Only delete project shells created before this many hours ago.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=500,
        help="Maximum number of drafts to delete in one run.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report what would be deleted without deleting anything.",
    )
    return parser.parse_args()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    args = parse_args()
    cutoff = datetime.datetime.utcnow() - datetime.timedelta(hours=args.max_age_hours)

    with SessionLocal() as db:
        if args.dry_run:
            candidates = (
                db.query(Project)
                .filter(
                    Project.status.in_(("draft", "project")),
                    Project.created_at < cutoff,
                    ~Project.report.has(),
                    ~Project.draft.has(),
                )
                .limit(args.limit)
                .all()
            )
            abandoned = [p.id for p in candidates if not p.finance_state]
            logger.info(
                "Dry run: %s abandoned project(s) older than %sh would be deleted.",
                len(abandoned),
                args.max_age_hours,
            )
            for project_id in abandoned:
                logger.info("  would delete %s", project_id)
            return

        deleted_ids = ReportRepository.delete_abandoned_drafts(
            db, older_than=cutoff, limit=args.limit
        )
        logger.info(
            "Deleted %s abandoned project(s) older than %sh.",
            len(deleted_ids),
            args.max_age_hours,
        )


if __name__ == "__main__":
    main()
