-- Plotalign Database Schema
--
-- Canonical reference for the production (Supabase) schema. The actual runtime
-- source of truth is the SQLAlchemy ORM in api/database/models.py plus the
-- additive startup migrations in api/database/core.py (ensure_database_schema)
-- and api/database/rate_limit_rollout.py. This file documents the resulting
-- intended schema; keep it in sync when those change.
--
-- Table order: users -> admin_users -> projects -> reports -> drafts
--              -> published_listings -> saved_listings
--              -> user_service_balances -> user_service_transactions
--              -> chat_usage -> chat_usage_logs -> handbook_chunks

-- 1. Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Users (central identity, maps to Supabase Auth UUIDs)
CREATE TABLE IF NOT EXISTS public.users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    role TEXT DEFAULT 'buyer',
    avatar_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2b. Admin Users (privilege flag, orthogonal to users.role; one row per admin.
--     Source of truth for admin access — the FastAPI require_admin dependency
--     queries this table. Seed manually with the Supabase auth UUIDs of your admins.)
CREATE TABLE IF NOT EXISTS public.admin_users (
    user_id TEXT PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
-- Seed admins manually (run once in the Supabase SQL editor):
--   INSERT INTO public.admin_users (user_id)
--   VALUES ('<supabase-uuid-admin-1>'), ('<supabase-uuid-admin-2>')
--   ON CONFLICT DO NOTHING;

-- 3. Projects (lifecycle hub — central entity linking reports, drafts, and listings)
CREATE TABLE IF NOT EXISTS public.projects (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    status TEXT DEFAULT 'new' NOT NULL,
    address TEXT,
    property_area_sqft DOUBLE PRECISION,
    buildable_area_sqft DOUBLE PRECISION,
    setback_ft DOUBLE PRECISION,
    max_adu_sqft DOUBLE PRECISION,
    adu_sqft DOUBLE PRECISION,
    adu_type TEXT,
    adu_shape TEXT,
    primary_use TEXT,
    blocker_types JSONB,
    fire_hazard_severity TEXT,
    fire_hazard_zone_type TEXT,
    county TEXT,
    current_yard_zone TEXT,
    adu_clearances JSONB,
    finance_state JSONB,
    map_snapshot JSONB,
    report_preload JSONB,
    report_preload_pending_jobs INTEGER DEFAULT 0 NOT NULL,
    report_preload_updated_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. Reports (1:1 with project — feasibility report visible/context JSONB)
CREATE TABLE IF NOT EXISTS public.reports (
    id TEXT PRIMARY KEY,
    project_id TEXT UNIQUE REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
    version INTEGER DEFAULT 1 NOT NULL,
    visible JSONB DEFAULT '{}'::jsonb NOT NULL,
    context JSONB DEFAULT '{}'::jsonb NOT NULL,
    last_modified TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 5. Drafts (1:1 with project — editor form state with field_meta tracking)
CREATE TABLE IF NOT EXISTS public.drafts (
    id TEXT PRIMARY KEY,
    project_id TEXT UNIQUE REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
    seller_id TEXT REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    version INTEGER DEFAULT 1 NOT NULL,
    draft_payload JSONB DEFAULT '{}'::jsonb NOT NULL,
    field_meta JSONB DEFAULT '{}'::jsonb NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 6. Published Listings (marketplace data ONLY — no drafts, no status column;
--    draft/field_meta state lives in public.drafts, lifecycle state in projects.status)
CREATE TABLE IF NOT EXISTS public.published_listings (
    id TEXT PRIMARY KEY,
    seller_id TEXT REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    project_id TEXT UNIQUE REFERENCES public.projects(id) ON DELETE CASCADE,
    adu_type TEXT,
    permit_status TEXT,
    address TEXT,
    city TEXT,
    state TEXT,
    zip_code TEXT,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    monthly_rent DOUBLE PRECISION,
    bedrooms INTEGER,
    bathrooms DOUBLE PRECISION,
    sqft DOUBLE PRECISION,
    hero_image TEXT,
    seo_title TEXT,
    description TEXT,
    image_gallery JSONB DEFAULT '[]'::jsonb,
    amenities JSONB DEFAULT '[]'::jsonb,
    utilities_included JSONB DEFAULT '[]'::jsonb,
    lease_term TEXT,
    pet_policy TEXT,
    furnished TEXT,
    available_date TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    view_count INTEGER DEFAULT 0 NOT NULL,
    save_count INTEGER DEFAULT 0 NOT NULL
);

-- 7. Saved Listings (buyer favorites)
CREATE TABLE IF NOT EXISTS public.saved_listings (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    listing_id TEXT REFERENCES public.published_listings(id) ON DELETE CASCADE NOT NULL,
    saved_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 8. User Service Balances (current consumable-credit state)
CREATE TABLE IF NOT EXISTS public.user_service_balances (
    balance_id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    service_type TEXT NOT NULL,
    balance INTEGER DEFAULT 0 NOT NULL,
    last_updated_by_actor_type TEXT NOT NULL,
    last_updated_by_actor_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT ck_user_service_balance_non_negative CHECK (balance >= 0),
    CONSTRAINT ux_user_service_balance UNIQUE (user_id, service_type)
);

-- 9. User Service Transactions (immutable credit/debit ledger)
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
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT ck_user_service_transaction_non_zero CHECK (delta <> 0)
);

-- 10. Chat Usage (per-user chat budget and current usage)
CREATE TABLE IF NOT EXISTS public.chat_usage (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    api_key_hash TEXT UNIQUE NOT NULL,
    name TEXT,
    budget_micros BIGINT NOT NULL,
    budget_currency TEXT DEFAULT 'USD' NOT NULL,
    used_micros BIGINT DEFAULT 0 NOT NULL,
    usage_reset_interval_days INTEGER,
    last_reset_at TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_by_actor_type TEXT DEFAULT 'migration' NOT NULL,
    updated_by_actor_id TEXT,
    updated_reason TEXT DEFAULT 'chat_usage_migration' NOT NULL
);

-- 11. Chat Usage Logs (usage, reset, and budget-change ledger)
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
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 12. Handbook Chunks (pgvector store for RAG)
CREATE TABLE IF NOT EXISTS public.handbook_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    embedding VECTOR(3072),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 11. Row Level Security
--     The backend connects with a direct Postgres role that bypasses RLS, so
--     RLS here is defense-in-depth for the Supabase anon/auth roles. RLS is
--     enabled on every table; tables without an explicit policy are backend-only
--     (deny-all to anon/auth).
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
-- admin_users: enabled with no policy => backend-only (deny-all to anon/auth).
-- The frontend never reads this directly (it calls GET /admin/me); only the
-- backend (which bypasses RLS) touches it. A using(exists(...)) admin-bypass
-- policy belongs on OTHER tables when those admin features are built, not here.
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.published_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_service_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_service_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.handbook_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can only access their own projects" ON public.projects
    FOR ALL USING (auth.uid()::text = user_id);

CREATE POLICY "Public read access for handbook" ON public.handbook_chunks
    FOR SELECT USING (true);

-- 12. Performance Indexes
CREATE INDEX IF NOT EXISTS ix_users_email ON public.users(email);

CREATE INDEX IF NOT EXISTS ix_projects_status ON public.projects(status);
CREATE INDEX IF NOT EXISTS ix_projects_user_id ON public.projects(user_id);

CREATE INDEX IF NOT EXISTS ix_drafts_project_id ON public.drafts(project_id);
CREATE INDEX IF NOT EXISTS ix_drafts_seller_id ON public.drafts(seller_id);

CREATE INDEX IF NOT EXISTS ix_published_listings_seller_id ON public.published_listings(seller_id);
CREATE INDEX IF NOT EXISTS ix_published_listings_project_id ON public.published_listings(project_id);
CREATE INDEX IF NOT EXISTS ix_published_listings_adu_type ON public.published_listings(adu_type);
CREATE INDEX IF NOT EXISTS ix_published_listings_permit_status ON public.published_listings(permit_status);
CREATE INDEX IF NOT EXISTS ix_published_listings_city ON public.published_listings(city);
CREATE INDEX IF NOT EXISTS ix_published_listings_zip_code ON public.published_listings(zip_code);
CREATE INDEX IF NOT EXISTS ix_published_listings_monthly_rent ON public.published_listings(monthly_rent);
CREATE INDEX IF NOT EXISTS ix_published_listings_bedrooms ON public.published_listings(bedrooms);
CREATE INDEX IF NOT EXISTS ix_published_listings_bathrooms ON public.published_listings(bathrooms);
CREATE INDEX IF NOT EXISTS ix_published_listings_sqft ON public.published_listings(sqft);

CREATE INDEX IF NOT EXISTS ix_saved_listings_user_id ON public.saved_listings(user_id);
CREATE INDEX IF NOT EXISTS ix_saved_listings_listing_id ON public.saved_listings(listing_id);

CREATE INDEX IF NOT EXISTS ix_user_service_balances_user_id ON public.user_service_balances(user_id);
CREATE INDEX IF NOT EXISTS ix_user_service_balances_service_type ON public.user_service_balances(service_type);

CREATE INDEX IF NOT EXISTS ix_user_service_transactions_user_id ON public.user_service_transactions(user_id);
CREATE INDEX IF NOT EXISTS ix_user_service_transactions_service_type ON public.user_service_transactions(service_type);
CREATE INDEX IF NOT EXISTS ix_user_service_transactions_project_id ON public.user_service_transactions(project_id);
CREATE INDEX IF NOT EXISTS ix_user_service_transactions_request_id ON public.user_service_transactions(request_id);
CREATE INDEX IF NOT EXISTS ix_user_service_transactions_idempotency_key ON public.user_service_transactions(idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS ux_user_service_transactions_idempotency_key
    ON public.user_service_transactions(idempotency_key) WHERE (idempotency_key IS NOT NULL);

CREATE INDEX IF NOT EXISTS ix_chat_usage_user_id ON public.chat_usage(user_id);
CREATE INDEX IF NOT EXISTS ix_chat_usage_api_key_hash ON public.chat_usage(api_key_hash);
CREATE UNIQUE INDEX IF NOT EXISTS ux_chat_usage_one_active_row_per_user
    ON public.chat_usage(user_id) WHERE (is_active = true);

CREATE INDEX IF NOT EXISTS ix_chat_usage_logs_chat_usage_id ON public.chat_usage_logs(chat_usage_id);
CREATE INDEX IF NOT EXISTS ix_chat_usage_logs_request_id ON public.chat_usage_logs(request_id);
