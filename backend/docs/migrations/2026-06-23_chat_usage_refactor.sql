-- Refactor API-key budget accounting into chat_usage current-state + ledger tables.
-- Run with:
--
--   psql "$SUPABASE_DATABASE_URL" -v ON_ERROR_STOP=1 -f docs/migrations/2026-06-23_chat_usage_refactor.sql
--
-- Take a Supabase snapshot first. This migration keeps historical rows and
-- backfills chat_usage.used_micros from existing usage logs.

BEGIN;

ALTER TABLE IF EXISTS public.api_keys RENAME TO chat_usage;
ALTER TABLE IF EXISTS public.token_usage_logs RENAME TO chat_usage_logs;

ALTER TABLE public.chat_usage
    ADD COLUMN IF NOT EXISTS used_micros BIGINT DEFAULT 0 NOT NULL,
    ADD COLUMN IF NOT EXISTS usage_reset_interval_days INTEGER,
    ADD COLUMN IF NOT EXISTS last_reset_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL,
    ADD COLUMN IF NOT EXISTS updated_by_actor_type TEXT DEFAULT 'migration' NOT NULL,
    ADD COLUMN IF NOT EXISTS updated_by_actor_id TEXT,
    ADD COLUMN IF NOT EXISTS updated_reason TEXT DEFAULT 'chat_usage_migration' NOT NULL;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'chat_usage'
          AND column_name = 'usage_reset_at'
    ) THEN
        UPDATE public.chat_usage
        SET last_reset_at = usage_reset_at
        WHERE last_reset_at IS NULL
          AND usage_reset_at IS NOT NULL;
    END IF;
END $$
;

ALTER TABLE public.chat_usage
    DROP COLUMN IF EXISTS usage_reset_at,
    DROP COLUMN IF EXISTS budget_period,
    DROP COLUMN IF EXISTS token_budget;

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
;

ALTER TABLE public.chat_usage_logs
    ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES public.users(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS event_type TEXT DEFAULT 'usage' NOT NULL,
    ADD COLUMN IF NOT EXISTS delta_micros BIGINT DEFAULT 0 NOT NULL,
    ADD COLUMN IF NOT EXISTS used_micros_after BIGINT,
    ADD COLUMN IF NOT EXISTS budget_micros_after BIGINT,
    ADD COLUMN IF NOT EXISTS actor_type TEXT DEFAULT 'usage_meter' NOT NULL,
    ADD COLUMN IF NOT EXISTS actor_id TEXT,
    ADD COLUMN IF NOT EXISTS reason TEXT,
    ADD COLUMN IF NOT EXISTS metadata JSONB;

ALTER TABLE public.chat_usage_logs
    ALTER COLUMN tokens_used DROP NOT NULL,
    ALTER COLUMN cached_tokens DROP NOT NULL,
    ALTER COLUMN provider DROP NOT NULL,
    ALTER COLUMN model DROP NOT NULL,
    ALTER COLUMN request_id DROP NOT NULL;

UPDATE public.chat_usage_logs AS logs
SET user_id = usage.user_id,
    event_type = COALESCE(logs.event_type, 'usage'),
    delta_micros = CASE
        WHEN logs.route = 'map_search' THEN 0
        ELSE COALESCE(NULLIF(logs.delta_micros, 0), logs.cost_micros, 0)
    END,
    actor_type = COALESCE(logs.actor_type, 'usage_meter'),
    actor_id = COALESCE(logs.actor_id, logs.request_id),
    reason = COALESCE(logs.reason, 'chat_usage'),
    budget_micros_after = COALESCE(logs.budget_micros_after, usage.budget_micros)
FROM public.chat_usage AS usage
WHERE logs.chat_usage_id = usage.id;

UPDATE public.chat_usage AS usage
SET used_micros = COALESCE(log_totals.total_used, 0),
    updated_at = timezone('utc', now()),
    updated_by_actor_type = 'migration',
    updated_by_actor_id = '2026-06-23_chat_usage_refactor',
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
WHERE usage.id = log_totals.chat_usage_id;

UPDATE public.chat_usage AS usage
SET used_micros = 0,
    updated_at = timezone('utc', now()),
    updated_by_actor_type = 'migration',
    updated_by_actor_id = '2026-06-23_chat_usage_refactor',
    updated_reason = 'backfill_used_micros'
WHERE used_micros IS NULL;

DROP INDEX IF EXISTS public.ix_api_keys_user_id;
DROP INDEX IF EXISTS public.ix_api_keys_api_key_hash;
DROP INDEX IF EXISTS public.ix_token_usage_logs_api_key_id;
DROP INDEX IF EXISTS public.ix_token_usage_logs_request_id;
DROP INDEX IF EXISTS public.ux_api_keys_one_active_key_per_user;

CREATE INDEX IF NOT EXISTS ix_chat_usage_user_id
    ON public.chat_usage(user_id);
CREATE INDEX IF NOT EXISTS ix_chat_usage_api_key_hash
    ON public.chat_usage(api_key_hash);
CREATE UNIQUE INDEX IF NOT EXISTS ux_chat_usage_one_active_row_per_user
    ON public.chat_usage(user_id)
    WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS ix_chat_usage_logs_chat_usage_id
    ON public.chat_usage_logs(chat_usage_id);
CREATE INDEX IF NOT EXISTS ix_chat_usage_logs_request_id
    ON public.chat_usage_logs(request_id);

ALTER TABLE public.chat_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_usage_logs ENABLE ROW LEVEL SECURITY;

COMMIT;
