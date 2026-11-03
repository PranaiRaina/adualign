CREATE TABLE IF NOT EXISTS public.admin_usage_settings (
    id TEXT PRIMARY KEY,
    default_budget_micros BIGINT NOT NULL,
    default_usage_reset_interval_days INTEGER,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL,
    updated_by_actor_id TEXT
);
