-- Minimal schema for CI (plain Postgres + pgvector).
-- Omits Supabase-only RLS/policies that reference auth.uid().
-- Mirrors docs/db_schema.sql; keep the two in sync.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS public.users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    role TEXT DEFAULT 'buyer',
    avatar_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

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
    adu_width_ft DOUBLE PRECISION,
    adu_length_ft DOUBLE PRECISION,
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

CREATE TABLE IF NOT EXISTS public.reports (
    id TEXT PRIMARY KEY,
    project_id TEXT UNIQUE REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
    version INTEGER DEFAULT 1 NOT NULL,
    visible JSONB DEFAULT '{}'::jsonb NOT NULL,
    context JSONB DEFAULT '{}'::jsonb NOT NULL,
    last_modified TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

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

CREATE TABLE IF NOT EXISTS public.saved_listings (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    listing_id TEXT REFERENCES public.published_listings(id) ON DELETE CASCADE NOT NULL,
    saved_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

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

CREATE TABLE IF NOT EXISTS public.handbook_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    embedding VECTOR(3072),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

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

CREATE INDEX IF NOT EXISTS ix_chat_usage_user_id ON public.chat_usage(user_id);
CREATE INDEX IF NOT EXISTS ix_chat_usage_api_key_hash ON public.chat_usage(api_key_hash);
CREATE UNIQUE INDEX IF NOT EXISTS ux_chat_usage_one_active_row_per_user
    ON public.chat_usage(user_id) WHERE (is_active = true);

CREATE INDEX IF NOT EXISTS ix_chat_usage_logs_chat_usage_id ON public.chat_usage_logs(chat_usage_id);
CREATE INDEX IF NOT EXISTS ix_chat_usage_logs_request_id ON public.chat_usage_logs(request_id);
