-- Remove legacy map-only project status now that map-only mode is retired.
--
-- Run with:
--   psql "$SUPABASE_DATABASE_URL" -v ON_ERROR_STOP=1 -f docs/migrations/2026-06-22_remove_map_saved_status.sql

BEGIN;

UPDATE public.projects
SET status = 'project'
WHERE status = 'map_saved';

COMMIT;
