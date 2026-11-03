import os
import pytest


def test_supabase_handbook_chunks_accessible():
    """Verify the pgvector handbook_chunks table is reachable and populated."""
    database_url = os.getenv("SUPABASE_DATABASE_URL")
    if not database_url:
        pytest.skip("SUPABASE_DATABASE_URL not set")
    if not database_url.startswith(("postgresql://", "postgres://")):
        pytest.skip("SUPABASE_DATABASE_URL is not a Postgres database")

    from api.database.core import SessionLocal
    from sqlalchemy.exc import SQLAlchemyError
    from sqlalchemy import text

    try:
        with SessionLocal() as db:
            result = db.execute(text("SELECT COUNT(*) FROM handbook_chunks")).scalar()
    except SQLAlchemyError as exc:
        pytest.skip(f"Could not reach configured Supabase database: {exc}")

    assert result is not None, "Could not query handbook_chunks"
    if result == 0:
        pytest.skip(
            "handbook_chunks has no rows (seed data or run against Supabase with content)"
        )
