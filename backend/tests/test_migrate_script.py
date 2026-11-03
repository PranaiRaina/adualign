"""Tests for the one-shot migration entrypoint (scripts/migrate.py).

These lock in the fix that moved schema migration OFF every app startup
(which raced across replicas) and INTO a single one-shot command.
"""

import inspect
from unittest.mock import patch


def test_migrate_main_calls_ensure_database_schema():
    """Running the script applies the schema exactly once and exits 0."""
    with patch("scripts.migrate.ensure_database_schema") as mock_ensure:
        from scripts.migrate import main

        rc = main()

    assert rc == 0
    mock_ensure.assert_called_once_with()


def test_migrate_main_returns_nonzero_on_failure():
    """A failed migration must surface as a non-zero exit code, not a silent pass."""
    with patch(
        "scripts.migrate.ensure_database_schema",
        side_effect=RuntimeError("boom"),
    ):
        from scripts.migrate import main

        rc = main()

    assert rc == 1


def test_startup_does_not_run_schema_migration():
    """Regression: schema migration must NOT run on FastAPI startup anymore."""
    import api.main

    src = inspect.getsource(api.main.startup)
    assert "ensure_database_schema" not in src, (
        "ensure_database_schema() must not run on app startup; "
        "run scripts/migrate.py as a one-shot step instead."
    )
