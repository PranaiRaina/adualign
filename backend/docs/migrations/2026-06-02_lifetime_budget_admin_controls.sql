-- Move AI rate-limit budgets to lifetime limits without overwriting custom budgets.
--
-- Safe to run while older app instances are still deployed:
-- - Does not drop usage_adjustment_micros, because old code may still reference it.
-- - Clears stale adjustments so old code cannot keep forcing displayed usage to 0%.
-- - Preserves each row's budget_micros; only the period/default changes.

BEGIN;

ALTER TABLE public.api_keys
    ALTER COLUMN budget_period SET DEFAULT 'lifetime';

UPDATE public.api_keys
SET budget_period = 'lifetime'
WHERE is_active = TRUE
  AND budget_period IS DISTINCT FROM 'lifetime';

UPDATE public.api_keys
SET usage_adjustment_micros = 0
WHERE usage_adjustment_micros IS NOT NULL
  AND usage_adjustment_micros <> 0;

COMMIT;
