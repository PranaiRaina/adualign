"""Tests for ensure_database_schema() startup safety (api/database/core.py)."""

from contextlib import contextmanager
from unittest.mock import MagicMock, patch


def _run_ensure_database_schema() -> list[str]:
    """Execute ensure_database_schema() with a fake connection and return all SQL run."""
    executed_sql: list[str] = []

    def fake_execute(stmt):
        sql = stmt.text if hasattr(stmt, "text") else str(stmt)
        executed_sql.append(sql)
        result = MagicMock()
        if "column_name = 'status'" in sql:
            result.scalar.return_value = False
        else:
            result.scalar.return_value = 0
            result.rowcount = 0
        return result

    conn = MagicMock()
    conn.execute = fake_execute

    @contextmanager
    def fake_begin():
        yield conn

    with patch("api.database.core.engine") as mock_engine:
        mock_engine.begin = fake_begin
        from api.database.core import ensure_database_schema

        ensure_database_schema()

    return executed_sql


def test_startup_does_not_crash_with_null_budget_rows():
    """ensure_database_schema() must warn, not crash, when chat_usage has NULL budget_micros."""
    _run_ensure_database_schema()


def test_startup_does_not_enforce_set_not_null():
    """ALTER COLUMN budget_micros SET NOT NULL must not run at boot time."""
    executed_sql = _run_ensure_database_schema()
    set_not_null = [
        s for s in executed_sql if "budget_micros" in s and "SET NOT NULL" in s
    ]
    assert set_not_null == [], (
        "ensure_database_schema should not run ALTER COLUMN SET NOT NULL on budget_micros"
    )


def test_startup_still_runs_additive_ddl():
    """Core additive DDL (CREATE TABLE, ADD COLUMN, indexes) must still execute."""
    executed_sql = _run_ensure_database_schema()
    all_sql = "\n".join(executed_sql)

    assert "CREATE TABLE IF NOT EXISTS public.chat_usage" in all_sql
    assert "CREATE TABLE IF NOT EXISTS public.chat_usage_logs" in all_sql
    assert "CREATE TABLE IF NOT EXISTS public.admin_usage_settings" in all_sql
    assert "CREATE TABLE IF NOT EXISTS public.user_service_balances" in all_sql
    assert "CREATE TABLE IF NOT EXISTS public.user_service_transactions" in all_sql
    assert "ADD COLUMN IF NOT EXISTS budget_micros" in all_sql
    assert "ADD COLUMN IF NOT EXISTS used_micros" in all_sql
    assert "ADD COLUMN IF NOT EXISTS usage_reset_interval_days" in all_sql
    assert "ADD COLUMN IF NOT EXISTS last_reset_at" in all_sql
    assert "ADD COLUMN IF NOT EXISTS map_snapshot" in all_sql
    assert "ADD COLUMN IF NOT EXISTS report_input_version" in all_sql
    assert "ADD COLUMN IF NOT EXISTS source_project_version" in all_sql
    assert "ux_user_service_transactions_idempotency_key" in all_sql


def test_startup_does_not_repair_rate_limit_rollout_data():
    """Startup must not mutate live rate-limit rows for rollout repair anymore."""
    executed_sql = _run_ensure_database_schema()
    all_sql = "\n".join(executed_sql)

    assert "WITH ranked_keys AS" not in all_sql
    assert "ux_chat_usage_one_active_row_per_user" not in all_sql
    assert "WHERE budget_micros IS NULL" not in all_sql
