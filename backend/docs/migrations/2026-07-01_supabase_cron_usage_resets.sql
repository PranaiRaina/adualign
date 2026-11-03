-- Supabase pg_cron replacement for the Celery beat usage-reset heartbeat.
--
-- Every 15 minutes, Supabase calls the backend's internal sweep endpoint,
-- which resets due chat-usage budgets in the DB and clears the matching
-- Upstash Redis counters. The endpoint is idempotent.
--
-- The BACKEND_URL below points at the Railway production deployment.
-- Before running, replace the <CRON_SECRET> placeholder with the shared
-- secret; it must match the value of the CRON_SECRET env var set on the
-- backend. Generate one with:  openssl rand -hex 32
--
-- Run in the Supabase SQL editor (or psql as the postgres role).

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- cron.schedule() upserts by job name, so re-running this file is safe.
select cron.schedule(
    'reset-due-chat-usage-every-15-minutes',
    '*/15 * * * *',
    $$
    select net.http_post(
        url := 'https://adyou2-backend-production.up.railway.app/internal/usage-resets/run',
        headers := jsonb_build_object(
            'X-Cron-Secret', '<CRON_SECRET>',
            'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000
    );
    $$
);

-- Useful checks after scheduling:
--   select * from cron.job;                                  -- job registered?
--   select * from cron.job_run_details order by start_time desc limit 10;
--   select * from net._http_response order by created desc limit 10;
--
-- To remove the job:
--   select cron.unschedule('reset-due-chat-usage-every-15-minutes');
