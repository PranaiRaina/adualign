from __future__ import annotations

import argparse
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from api.database.models import Project

CONFIRMATION_WORD = "CONVERT"


@dataclass(frozen=True)
class ConversionArgs:
    project_ids: list[str]
    include_all: bool
    apply: bool
    yes: bool


def add_common_conversion_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--project-id",
        dest="project_ids",
        action="append",
        default=[],
        help="Project id to convert. Repeat to convert multiple projects.",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Convert all eligible projects.",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Apply changes. Without this flag, the script performs a dry run.",
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Skip the interactive confirmation prompt. Requires --apply.",
    )


def parse_common_conversion_args(namespace: argparse.Namespace) -> ConversionArgs:
    args = ConversionArgs(
        project_ids=list(namespace.project_ids or []),
        include_all=bool(namespace.all),
        apply=bool(namespace.apply),
        yes=bool(namespace.yes),
    )
    if args.yes and not args.apply:
        raise SystemExit("--yes requires --apply.")
    if args.include_all == bool(args.project_ids):
        raise SystemExit("Pass either --all or one or more --project-id values.")
    return args


def query_projects(
    db: Session, args: ConversionArgs, *, eligible_status: str
) -> list[Project]:
    query = db.query(Project)
    if args.include_all:
        return query.filter(Project.status == eligible_status).all()
    return query.filter(Project.id.in_(args.project_ids)).all()


def require_confirmation(*, args: ConversionArgs, warning: str) -> None:
    if not args.apply:
        return
    if args.yes:
        return

    print(warning)
    response = input(f"Type {CONFIRMATION_WORD} to continue: ").strip()
    if response != CONFIRMATION_WORD:
        raise SystemExit("Conversion cancelled.")


def project_label(project: Any) -> str:
    address = getattr(project, "address", None)
    if address:
        return f"{project.id} ({address})"
    return str(project.id)
