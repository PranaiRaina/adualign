-- Reconcile live Supabase DB with the canonical schema (docs/db_schema.sql)
-- Generated 2026-05-31. REVIEW BEFORE RUNNING. Not auto-applied.
--
-- Context: an audit found the live DB had drifted from the ORM models
-- (api/database/models.py) and from docs/db_schema.sql. This script removes
-- legacy leftovers and aligns indexes. Run against SUPABASE_DATABASE_URL with:
--
--   psql "$SUPABASE_DATABASE_URL" -v ON_ERROR_STOP=1 -f docs/migrations/2026-05-31_reconcile_live_db.sql
--
-- TAKE A BACKUP / Supabase snapshot first. Part A is recommended; Part B is
-- optional type hygiene. Everything is wrapped in a single transaction — if
-- anything fails, nothing is applied.

BEGIN;

-- =====================================================================
-- PART A — Remove legacy/orphan objects (recommended)
-- =====================================================================

-- A1. Drop orphan pgvector table. `grant_chunks` is referenced by zero code,
--     not in the ORM or schema files (abandoned experiment, ~2 rows).
DROP TABLE IF EXISTS public.grant_chunks;

-- A2. published_listings legacy columns (status / draft_payload / field_meta).
--     The Listing model has none of these — drafts live in public.drafts and
--     lifecycle state in projects.status. Before dropping, preserve any draft
--     payload still sitting in published_listings (mirrors the migration logic
--     in api/database/core.py Step 4) so no data is lost.
INSERT INTO public.drafts (id, project_id, seller_id, version, draft_payload, field_meta, created_at, updated_at)
SELECT
    l.id,
    l.project_id,
    l.seller_id,
    1,
    COALESCE(l.draft_payload, '{}'::jsonb),
    COALESCE(l.field_meta, '{}'::jsonb),
    COALESCE(l.created_at::timestamptz, timezone('utc', now())),
    COALESCE(l.updated_at::timestamptz, timezone('utc', now()))
FROM public.published_listings l
WHERE l.status = 'draft'
  AND l.project_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.drafts d WHERE d.project_id = l.project_id)
ON CONFLICT (project_id) DO NOTHING;

-- !!! DATA REVIEW REQUIRED (does NOT block this script) !!!
-- At audit time all 8 published_listings rows had status='draft' (3) or
-- status='report' (5) — i.e. none were genuinely "published", yet the
-- marketplace query (api/routers/listings.py get_published_listings) serves
-- ALL rows. Dropping the `status` column does NOT delete these rows; it only
-- removes the marker. Decide separately whether those rows belong in
-- published_listings. To inspect before running, comment out the BEGIN/COMMIT
-- and run:  SELECT id, project_id, status FROM public.published_listings;

ALTER TABLE public.published_listings DROP COLUMN IF EXISTS status;
ALTER TABLE public.published_listings DROP COLUMN IF EXISTS draft_payload;
ALTER TABLE public.published_listings DROP COLUMN IF EXISTS field_meta;

-- A3. api_keys.token_budget — legacy, superseded by budget_micros. Matches the
--     _drop_legacy_token_budget() step in api/database/rate_limit_rollout.py.
ALTER TABLE public.api_keys DROP COLUMN IF EXISTS token_budget;

-- =====================================================================
-- PART A — Index reconciliation
-- =====================================================================

-- A4. Create canonical indexes that are declared by the ORM / schema but
--     missing in the live DB.
CREATE INDEX IF NOT EXISTS ix_projects_user_id ON public.projects(user_id);
CREATE INDEX IF NOT EXISTS ix_drafts_project_id ON public.drafts(project_id);
CREATE INDEX IF NOT EXISTS ix_drafts_seller_id ON public.drafts(seller_id);

-- Canonical published_listings indexes (currently only present under the old
-- ix_listings_* names from before the table was renamed).
CREATE INDEX IF NOT EXISTS ix_published_listings_adu_type ON public.published_listings(adu_type);
CREATE INDEX IF NOT EXISTS ix_published_listings_permit_status ON public.published_listings(permit_status);
CREATE INDEX IF NOT EXISTS ix_published_listings_zip_code ON public.published_listings(zip_code);
CREATE INDEX IF NOT EXISTS ix_published_listings_bedrooms ON public.published_listings(bedrooms);
CREATE INDEX IF NOT EXISTS ix_published_listings_bathrooms ON public.published_listings(bathrooms);
CREATE INDEX IF NOT EXISTS ix_published_listings_sqft ON public.published_listings(sqft);

-- A5. Drop the legacy ix_listings_* indexes (duplicates of the canonical names
--     above, plus ix_listings_status for the dropped column and ix_listings_id
--     which duplicates the primary key).
DROP INDEX IF EXISTS public.ix_listings_adu_type;
DROP INDEX IF EXISTS public.ix_listings_bathrooms;
DROP INDEX IF EXISTS public.ix_listings_bedrooms;
DROP INDEX IF EXISTS public.ix_listings_city;
DROP INDEX IF EXISTS public.ix_listings_id;
DROP INDEX IF EXISTS public.ix_listings_monthly_rent;
DROP INDEX IF EXISTS public.ix_listings_permit_status;
DROP INDEX IF EXISTS public.ix_listings_project_id;
DROP INDEX IF EXISTS public.ix_listings_seller_id;
DROP INDEX IF EXISTS public.ix_listings_sqft;
DROP INDEX IF EXISTS public.ix_listings_status;
DROP INDEX IF EXISTS public.ix_listings_zip_code;

-- =====================================================================
-- PART B — Type hygiene (OPTIONAL). Aligns drifted columns to the canonical
-- types (text / jsonb / timestamptz). Functionally low-impact: unbounded
-- varchar already behaves like text. The timestamp->timestamptz casts assume
-- existing naive values are UTC (true for this app — defaults use
-- timezone('utc', now())). Review, then uncomment to apply.
-- =====================================================================

-- -- json -> jsonb (published_listings)
-- ALTER TABLE public.published_listings ALTER COLUMN image_gallery TYPE jsonb USING image_gallery::jsonb;
-- ALTER TABLE public.published_listings ALTER COLUMN amenities TYPE jsonb USING amenities::jsonb;
-- ALTER TABLE public.published_listings ALTER COLUMN utilities_included TYPE jsonb USING utilities_included::jsonb;

-- -- timestamp -> timestamptz (interpret stored values as UTC)
-- ALTER TABLE public.users ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
-- ALTER TABLE public.saved_listings ALTER COLUMN saved_at TYPE timestamptz USING saved_at AT TIME ZONE 'UTC';
-- ALTER TABLE public.published_listings ALTER COLUMN available_date TYPE timestamptz USING available_date AT TIME ZONE 'UTC';
-- ALTER TABLE public.published_listings ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
-- ALTER TABLE public.published_listings ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';

-- -- varchar -> text (cosmetic; safe). PK/FK id columns are intentionally left
-- -- out to avoid disturbing foreign-key dependencies — they already behave as text.
-- ALTER TABLE public.users ALTER COLUMN email TYPE text;
-- ALTER TABLE public.users ALTER COLUMN name TYPE text;
-- ALTER TABLE public.users ALTER COLUMN role TYPE text;
-- ALTER TABLE public.users ALTER COLUMN avatar_url TYPE text;
-- ALTER TABLE public.projects ALTER COLUMN fire_hazard_severity TYPE text;
-- ALTER TABLE public.projects ALTER COLUMN fire_hazard_zone_type TYPE text;
-- ALTER TABLE public.published_listings ALTER COLUMN adu_type TYPE text;
-- ALTER TABLE public.published_listings ALTER COLUMN permit_status TYPE text;
-- ALTER TABLE public.published_listings ALTER COLUMN address TYPE text;
-- ALTER TABLE public.published_listings ALTER COLUMN city TYPE text;
-- ALTER TABLE public.published_listings ALTER COLUMN state TYPE text;
-- ALTER TABLE public.published_listings ALTER COLUMN zip_code TYPE text;
-- ALTER TABLE public.published_listings ALTER COLUMN hero_image TYPE text;
-- ALTER TABLE public.published_listings ALTER COLUMN seo_title TYPE text;
-- ALTER TABLE public.published_listings ALTER COLUMN lease_term TYPE text;
-- ALTER TABLE public.published_listings ALTER COLUMN pet_policy TYPE text;
-- ALTER TABLE public.published_listings ALTER COLUMN furnished TYPE text;

COMMIT;
