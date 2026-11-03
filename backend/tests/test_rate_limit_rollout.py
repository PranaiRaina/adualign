"""Tests for the explicit rate-limit rollout predeploy migration."""

from __future__ import annotations

import pytest

from api.database.rate_limit_rollout import (
    apply_rate_limit_rollout_predeploy,
    ensure_rate_limit_startup_schema,
)


class _FakeResult:
    def __init__(self, *, scalar_value: int = 0, rowcount: int = 0):
        self._scalar_value = scalar_value
        self.rowcount = rowcount

    def scalar(self) -> int:
        return self._scalar_value


class _FakeConnection:
    def __init__(
        self,
        *,
        null_budget_rows: int,
        duplicate_active_keys: int,
    ) -> None:
        self.null_budget_rows = null_budget_rows
        self.duplicate_active_keys = duplicate_active_keys
        self.executed_sql: list[str] = []
        self.backfill_budgets: list[int] = []

    def execute(self, stmt, params=None):
        sql = stmt.text if hasattr(stmt, "text") else str(stmt)
        self.executed_sql.append(sql)

        if "SELECT COUNT(*)" in sql and "budget_micros IS NULL" in sql:
            return _FakeResult(scalar_value=self.null_budget_rows)

        if "SET budget_micros = :default_budget_micros" in sql:
            if params is None:
                raise AssertionError("Expected default budget params for backfill")
            self.backfill_budgets.append(int(params["default_budget_micros"]))
            updated_rows = self.null_budget_rows
            self.null_budget_rows = 0
            return _FakeResult(rowcount=updated_rows)

        if "WITH ranked_keys AS" in sql:
            updated_rows = self.duplicate_active_keys
            self.duplicate_active_keys = 0
            return _FakeResult(rowcount=updated_rows)

        return _FakeResult()


def test_predeploy_rollout_backfills_and_normalizes_legacy_state():
    conn = _FakeConnection(
        null_budget_rows=3,
        duplicate_active_keys=2,
    )

    summary = apply_rate_limit_rollout_predeploy(
        conn,
        default_budget_micros=500_000,
    )

    all_sql = "\n".join(conn.executed_sql)
    assert summary.null_budget_rows_before == 3
    assert summary.null_budget_rows_backfilled == 3
    assert summary.reset_rows_repaired == 0
    assert summary.active_keys_migrated_to_lifetime == 0
    assert summary.duplicate_active_keys_deactivated == 2
    assert summary.null_budget_rows_after == 0
    assert conn.backfill_budgets == [500_000]
    assert "CREATE TABLE IF NOT EXISTS public.chat_usage" in all_sql
    assert "CREATE TABLE IF NOT EXISTS public.chat_usage_logs" in all_sql
    assert (
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_chat_usage_one_active_row_per_user"
        in all_sql
    )
    assert (
        "ALTER TABLE public.chat_usage ALTER COLUMN budget_micros SET NOT NULL"
        in all_sql
    )
    assert "usage_window.last_reset_at IS NULL" in all_sql
    assert "logs.created_at >= usage_window.last_reset_at" in all_sql
    assert "updated_reason = 'usage_reset_repaired'" not in all_sql


def test_predeploy_rollout_is_idempotent():
    conn = _FakeConnection(
        null_budget_rows=2,
        duplicate_active_keys=1,
    )

    first = apply_rate_limit_rollout_predeploy(
        conn,
        default_budget_micros=500_000,
    )
    second = apply_rate_limit_rollout_predeploy(
        conn,
        default_budget_micros=500_000,
    )

    assert first.null_budget_rows_backfilled == 2
    assert first.reset_rows_repaired == 0
    assert first.active_keys_migrated_to_lifetime == 0
    assert first.duplicate_active_keys_deactivated == 1
    assert second.null_budget_rows_before == 0
    assert second.null_budget_rows_backfilled == 0
    assert second.reset_rows_repaired == 0
    assert second.active_keys_migrated_to_lifetime == 0
    assert second.duplicate_active_keys_deactivated == 0
    assert second.null_budget_rows_after == 0


def test_predeploy_rollout_rejects_non_positive_backfill_budget():
    conn = _FakeConnection(null_budget_rows=1, duplicate_active_keys=0)

    with pytest.raises(ValueError, match="positive integer"):
        apply_rate_limit_rollout_predeploy(
            conn,
            default_budget_micros=0,
        )


def test_startup_schema_helper_stays_additive_only():
    conn = _FakeConnection(null_budget_rows=4, duplicate_active_keys=3)

    ensure_rate_limit_startup_schema(conn)

    all_sql = "\n".join(conn.executed_sql)
    assert "WITH ranked_keys AS" not in all_sql
    assert "ux_chat_usage_one_active_row_per_user" not in all_sql
    assert (
        "ALTER TABLE public.chat_usage ALTER COLUMN budget_micros SET NOT NULL"
        not in all_sql
    )
    assert "WHERE budget_micros IS NULL" not in all_sql
    assert "updated_reason = 'backfill_used_micros'" not in all_sql
    assert "updated_reason = 'usage_reset_repaired'" not in all_sql
