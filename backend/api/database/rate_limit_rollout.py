"""Helpers for rate-limit schema rollout and predeploy normalization."""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine


@dataclass(frozen=True)
class RateLimitRolloutSummary:
    default_budget_micros: int
    null_budget_rows_before: int
    null_budget_rows_backfilled: int
    reset_rows_repaired: int
    active_keys_migrated_to_lifetime: int
    duplicate_active_keys_deactivated: int
    null_budget_rows_after: int


def ensure_rate_limit_startup_schema(conn: Connection) -> None:
    """Apply only additive DDL needed for startup-safe rate-limit support."""
    conn.execute(
        text("""
        CREATE TABLE IF NOT EXISTS public.admin_usage_settings (
            id TEXT PRIMARY KEY,
            default_budget_micros BIGINT NOT NULL,
            default_usage_reset_interval_days INTEGER,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL,
            updated_by_actor_id TEXT
        )
    """)
    )
    conn.execute(
        text("""
        CREATE TABLE IF NOT EXISTS public.user_service_balances (
            balance_id TEXT PRIMARY KEY,
            user_id TEXT REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
            service_type TEXT NOT NULL,
            balance INTEGER DEFAULT 0 NOT NULL,
            last_updated_by_actor_type TEXT NOT NULL,
            last_updated_by_actor_id TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL,
            CONSTRAINT ck_user_service_balance_non_negative CHECK (balance >= 0),
            CONSTRAINT ux_user_service_balance UNIQUE (user_id, service_type)
        )
    """)
    )
    conn.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_user_service_balances_user_id ON public.user_service_balances(user_id)"
        )
    )
    conn.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_user_service_balances_service_type ON public.user_service_balances(service_type)"
        )
    )

    conn.execute(
        text("""
        CREATE TABLE IF NOT EXISTS public.user_service_transactions (
            transaction_id TEXT PRIMARY KEY,
            user_id TEXT REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
            service_type TEXT NOT NULL,
            delta INTEGER NOT NULL,
            reason TEXT NOT NULL,
            idempotency_key TEXT,
            project_id TEXT REFERENCES public.projects(id) ON DELETE SET NULL,
            request_id TEXT,
            actor_type TEXT NOT NULL,
            actor_id TEXT,
            metadata JSONB,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL,
            CONSTRAINT ck_user_service_transaction_non_zero CHECK (delta <> 0)
        )
    """)
    )
    conn.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_user_service_transactions_user_id ON public.user_service_transactions(user_id)"
        )
    )
    conn.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_user_service_transactions_service_type ON public.user_service_transactions(service_type)"
        )
    )
    conn.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_user_service_transactions_project_id ON public.user_service_transactions(project_id)"
        )
    )
    conn.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_user_service_transactions_request_id ON public.user_service_transactions(request_id)"
        )
    )
    conn.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_user_service_transactions_idempotency_key ON public.user_service_transactions(idempotency_key)"
        )
    )
    conn.execute(
        text("""
        CREATE UNIQUE INDEX IF NOT EXISTS ux_user_service_transactions_idempotency_key
        ON public.user_service_transactions(idempotency_key)
        WHERE idempotency_key IS NOT NULL
    """)
    )

    _ensure_chat_usage_schema(conn)
    _ensure_chat_usage_logs_schema(conn)


def _ensure_chat_usage_schema(conn: Connection) -> None:
    conn.execute(
        text("""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = 'api_keys'
            ) AND NOT EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = 'chat_usage'
            ) THEN
                ALTER TABLE public.api_keys RENAME TO chat_usage;
            END IF;
        END $$
    """)
    )
    conn.execute(
        text("""
        CREATE TABLE IF NOT EXISTS public.chat_usage (
            id TEXT PRIMARY KEY,
            user_id TEXT REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
            api_key_hash TEXT UNIQUE NOT NULL,
            name TEXT,
            budget_micros BIGINT,
            budget_currency TEXT DEFAULT 'USD' NOT NULL,
            used_micros BIGINT DEFAULT 0 NOT NULL,
            usage_reset_interval_days INTEGER,
            last_reset_at TIMESTAMP WITH TIME ZONE,
            is_active BOOLEAN DEFAULT TRUE NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL,
            updated_by_actor_type TEXT DEFAULT 'migration' NOT NULL,
            updated_by_actor_id TEXT,
            updated_reason TEXT DEFAULT 'chat_usage_migration' NOT NULL
        )
    """)
    )
    conn.execute(
        text(
            "ALTER TABLE public.chat_usage ADD COLUMN IF NOT EXISTS budget_micros BIGINT"
        )
    )
    conn.execute(
        text(
            "ALTER TABLE public.chat_usage ADD COLUMN IF NOT EXISTS budget_currency TEXT DEFAULT 'USD' NOT NULL"
        )
    )
    conn.execute(
        text(
            "ALTER TABLE public.chat_usage ADD COLUMN IF NOT EXISTS used_micros BIGINT DEFAULT 0 NOT NULL"
        )
    )
    conn.execute(
        text(
            "ALTER TABLE public.chat_usage ADD COLUMN IF NOT EXISTS usage_reset_interval_days INTEGER"
        )
    )
    conn.execute(
        text(
            "ALTER TABLE public.chat_usage ADD COLUMN IF NOT EXISTS last_reset_at TIMESTAMP WITH TIME ZONE"
        )
    )
    conn.execute(
        text(
            "ALTER TABLE public.chat_usage ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL"
        )
    )
    conn.execute(
        text(
            "ALTER TABLE public.chat_usage ADD COLUMN IF NOT EXISTS updated_by_actor_type TEXT DEFAULT 'migration' NOT NULL"
        )
    )
    conn.execute(
        text(
            "ALTER TABLE public.chat_usage ADD COLUMN IF NOT EXISTS updated_by_actor_id TEXT"
        )
    )
    conn.execute(
        text(
            "ALTER TABLE public.chat_usage ADD COLUMN IF NOT EXISTS updated_reason TEXT DEFAULT 'chat_usage_migration' NOT NULL"
        )
    )
    conn.execute(
        text("""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'chat_usage'
                  AND column_name = 'usage_reset_at'
            ) AND NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'chat_usage'
                  AND column_name = 'last_reset_at'
            ) THEN
                ALTER TABLE public.chat_usage RENAME COLUMN usage_reset_at TO last_reset_at;
            END IF;
        END $$
    """)
    )
    conn.execute(
        text("ALTER TABLE public.chat_usage DROP COLUMN IF EXISTS budget_period")
    )
    conn.execute(
        text("ALTER TABLE public.chat_usage DROP COLUMN IF EXISTS token_budget")
    )
    conn.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_chat_usage_user_id ON public.chat_usage(user_id)"
        )
    )
    conn.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_chat_usage_api_key_hash ON public.chat_usage(api_key_hash)"
        )
    )


def _ensure_chat_usage_logs_schema(conn: Connection) -> None:
    conn.execute(
        text("""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = 'token_usage_logs'
            ) AND NOT EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = 'chat_usage_logs'
            ) THEN
                ALTER TABLE public.token_usage_logs RENAME TO chat_usage_logs;
            END IF;
        END $$
    """)
    )
    conn.execute(
        text("""
        CREATE TABLE IF NOT EXISTS public.chat_usage_logs (
            id TEXT PRIMARY KEY,
            chat_usage_id TEXT REFERENCES public.chat_usage(id) ON DELETE CASCADE NOT NULL,
            user_id TEXT REFERENCES public.users(id) ON DELETE CASCADE,
            event_type TEXT DEFAULT 'usage' NOT NULL,
            delta_micros BIGINT DEFAULT 0 NOT NULL,
            cost_micros BIGINT DEFAULT 0 NOT NULL,
            used_micros_after BIGINT,
            budget_micros_after BIGINT,
            tokens_used INTEGER,
            prompt_tokens INTEGER,
            completion_tokens INTEGER,
            total_tokens INTEGER,
            cached_tokens INTEGER DEFAULT 0,
            provider TEXT,
            route TEXT,
            source TEXT,
            is_estimated BOOLEAN DEFAULT FALSE NOT NULL,
            stream_terminated_early BOOLEAN DEFAULT FALSE NOT NULL,
            model TEXT,
            request_id TEXT,
            actor_type TEXT DEFAULT 'usage_meter' NOT NULL,
            actor_id TEXT,
            reason TEXT,
            metadata JSONB,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL
        )
    """)
    )
    conn.execute(
        text("""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'chat_usage_logs'
                  AND column_name = 'api_key_id'
            ) AND NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'chat_usage_logs'
                  AND column_name = 'chat_usage_id'
            ) THEN
                ALTER TABLE public.chat_usage_logs RENAME COLUMN api_key_id TO chat_usage_id;
            END IF;
        END $$
    """)
    )
    conn.execute(
        text("""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'chat_usage_logs'
                  AND column_name = 'timestamp'
            ) AND NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'chat_usage_logs'
                  AND column_name = 'created_at'
            ) THEN
                ALTER TABLE public.chat_usage_logs RENAME COLUMN timestamp TO created_at;
            END IF;
        END $$
    """)
    )
    for statement in (
        "ALTER TABLE public.chat_usage_logs ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES public.users(id) ON DELETE CASCADE",
        "ALTER TABLE public.chat_usage_logs ADD COLUMN IF NOT EXISTS event_type TEXT DEFAULT 'usage' NOT NULL",
        "ALTER TABLE public.chat_usage_logs ADD COLUMN IF NOT EXISTS delta_micros BIGINT DEFAULT 0 NOT NULL",
        "ALTER TABLE public.chat_usage_logs ADD COLUMN IF NOT EXISTS used_micros_after BIGINT",
        "ALTER TABLE public.chat_usage_logs ADD COLUMN IF NOT EXISTS budget_micros_after BIGINT",
        "ALTER TABLE public.chat_usage_logs ADD COLUMN IF NOT EXISTS actor_type TEXT DEFAULT 'usage_meter' NOT NULL",
        "ALTER TABLE public.chat_usage_logs ADD COLUMN IF NOT EXISTS actor_id TEXT",
        "ALTER TABLE public.chat_usage_logs ADD COLUMN IF NOT EXISTS reason TEXT",
        "ALTER TABLE public.chat_usage_logs ADD COLUMN IF NOT EXISTS metadata JSONB",
    ):
        conn.execute(text(statement))
    conn.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_chat_usage_logs_chat_usage_id ON public.chat_usage_logs(chat_usage_id)"
        )
    )
    conn.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_chat_usage_logs_request_id ON public.chat_usage_logs(request_id)"
        )
    )


def _backfill_used_micros_from_logs(conn: Connection) -> None:
    conn.execute(
        text("""
        UPDATE public.chat_usage AS usage
        SET used_micros = COALESCE(log_totals.total_used, 0),
            updated_at = timezone('utc', now()),
            updated_by_actor_type = 'migration',
            updated_by_actor_id = 'chat_usage_startup_backfill',
            updated_reason = 'backfill_used_micros'
        FROM (
            SELECT logs.chat_usage_id, SUM(logs.cost_micros) AS total_used
            FROM public.chat_usage_logs AS logs
            JOIN public.chat_usage AS usage_window
              ON usage_window.id = logs.chat_usage_id
            WHERE logs.event_type = 'usage'
              AND (logs.route IS NULL OR logs.route <> 'map_search')
              AND (
                  usage_window.last_reset_at IS NULL
                  OR logs.created_at >= usage_window.last_reset_at
              )
            GROUP BY logs.chat_usage_id
        ) AS log_totals
        WHERE usage.id = log_totals.chat_usage_id
          AND COALESCE(usage.used_micros, 0) = 0
    """)
    )


def apply_rate_limit_rollout_predeploy(
    conn: Connection,
    *,
    default_budget_micros: int,
) -> RateLimitRolloutSummary:
    """Normalize legacy rate-limit rows before enabling stricter constraints."""
    _validate_default_budget_micros(default_budget_micros)
    ensure_rate_limit_startup_schema(conn)
    _backfill_used_micros_from_logs(conn)

    null_budget_rows_before = _count_null_budget_rows(conn)
    null_budget_rows_backfilled = _backfill_null_budgets(
        conn,
        default_budget_micros=default_budget_micros,
    )
    reset_rows_repaired = 0
    active_keys_migrated_to_lifetime = 0
    duplicate_active_keys_deactivated = _deactivate_duplicate_active_keys(conn)
    _create_unique_active_key_index(conn)
    _drop_legacy_token_budget(conn)
    null_budget_rows_after = _count_null_budget_rows(conn)
    if null_budget_rows_after:
        raise RuntimeError(
            "Rate-limit rollout cannot enforce budget_micros NOT NULL while "
            f"{null_budget_rows_after} chat_usage row(s) still have NULL budgets."
        )
    _enforce_budget_micros_not_null(conn)

    return RateLimitRolloutSummary(
        default_budget_micros=default_budget_micros,
        null_budget_rows_before=null_budget_rows_before,
        null_budget_rows_backfilled=null_budget_rows_backfilled,
        reset_rows_repaired=reset_rows_repaired,
        active_keys_migrated_to_lifetime=active_keys_migrated_to_lifetime,
        duplicate_active_keys_deactivated=duplicate_active_keys_deactivated,
        null_budget_rows_after=null_budget_rows_after,
    )


def apply_rate_limit_rollout_predeploy_to_engine(
    engine: Engine,
    *,
    default_budget_micros: int,
) -> RateLimitRolloutSummary:
    with engine.begin() as conn:
        return apply_rate_limit_rollout_predeploy(
            conn,
            default_budget_micros=default_budget_micros,
        )


def _count_null_budget_rows(conn: Connection) -> int:
    return int(
        conn.execute(
            text("""
        SELECT COUNT(*)
        FROM public.chat_usage
        WHERE budget_micros IS NULL
    """)
        ).scalar()
        or 0
    )


def _backfill_null_budgets(
    conn: Connection,
    *,
    default_budget_micros: int,
) -> int:
    return int(
        conn.execute(
            text("""
            UPDATE public.chat_usage
            SET budget_micros = :default_budget_micros
            WHERE budget_micros IS NULL
        """),
            {"default_budget_micros": default_budget_micros},
        ).rowcount
        or 0
    )


def _validate_default_budget_micros(default_budget_micros: int) -> None:
    if default_budget_micros <= 0:
        raise ValueError("default_budget_micros must be a positive integer")


def _deactivate_duplicate_active_keys(conn: Connection) -> int:
    return int(
        conn.execute(
            text("""
        WITH ranked_keys AS (
            SELECT
                id,
                ROW_NUMBER() OVER (
                    PARTITION BY user_id
                    ORDER BY created_at DESC, id DESC
                ) AS row_num
            FROM public.chat_usage
            WHERE is_active = TRUE
        )
        UPDATE public.chat_usage AS chat_usage
        SET is_active = FALSE
        FROM ranked_keys
        WHERE chat_usage.id = ranked_keys.id
          AND ranked_keys.row_num > 1
    """)
        ).rowcount
        or 0
    )


def _create_unique_active_key_index(conn: Connection) -> None:
    conn.execute(
        text("""
        CREATE UNIQUE INDEX IF NOT EXISTS ux_chat_usage_one_active_row_per_user
        ON public.chat_usage(user_id)
        WHERE is_active = TRUE
    """)
    )


def _enforce_budget_micros_not_null(conn: Connection) -> None:
    conn.execute(
        text("ALTER TABLE public.chat_usage ALTER COLUMN budget_micros SET NOT NULL")
    )


def _drop_legacy_token_budget(conn: Connection) -> None:
    conn.execute(
        text("ALTER TABLE public.chat_usage DROP COLUMN IF EXISTS token_budget")
    )
