from pathlib import Path
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base
import os
import logging
from dotenv import load_dotenv
from supabase import create_client, Client
from .rate_limit_rollout import ensure_rate_limit_startup_schema

logger = logging.getLogger(__name__)

repo_root = Path(__file__).resolve().parents[2]
backend_env = repo_root / ".env"
frontend_env_local = repo_root.parent / "ADYou2-Frontend" / ".env.local"
frontend_env = repo_root.parent / "ADYou2-Frontend" / ".env"

# Load backend .env first
if backend_env.exists():
    load_dotenv(backend_env, override=False)

# Then load frontend envs if available (e.g. for shared keys)
if frontend_env_local.exists():
    load_dotenv(frontend_env_local, override=False)
elif frontend_env.exists():
    load_dotenv(frontend_env, override=False)


SUPABASE_DATABASE_URL = os.getenv("SUPABASE_DATABASE_URL")

if not SUPABASE_DATABASE_URL:
    raise RuntimeError(
        "SUPABASE_DATABASE_URL not set in environment. Production database required."
    )

if SUPABASE_DATABASE_URL.startswith("postgres://"):
    SUPABASE_DATABASE_URL = SUPABASE_DATABASE_URL.replace(
        "postgres://", "postgresql://", 1
    )

engine = create_engine(
    SUPABASE_DATABASE_URL, pool_pre_ping=True, pool_size=10, max_overflow=20
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# ── Supabase Client Initialization (for Storage & Auth) ──────────────────
SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")

supabase_client: Client | None = None
if SUPABASE_URL and SUPABASE_KEY:
    supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY)
else:
    logger.warning("Supabase URL or Key missing. Storage features will be disabled.")

Base = declarative_base()


def ensure_database_schema() -> None:
    """Apply additive schema updates required by the backend."""
    with engine.begin() as conn:
        # ── Step 0: Create admin_users table if it doesn't exist ──
        conn.execute(
            text("""
            CREATE TABLE IF NOT EXISTS public.admin_users (
                user_id TEXT PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL
            )
        """)
        )

        # ── Step 1: Create drafts table if it doesn't exist ──
        conn.execute(
            text("""
            CREATE TABLE IF NOT EXISTS public.drafts (
                id TEXT PRIMARY KEY,
                project_id TEXT UNIQUE REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
                seller_id TEXT REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
                version INTEGER DEFAULT 1 NOT NULL,
                draft_payload JSONB DEFAULT '{}'::jsonb NOT NULL,
                field_meta JSONB DEFAULT '{}'::jsonb NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL
            )
        """)
        )

        # ── Step 2: Add status column to projects if missing ──
        conn.execute(
            text(
                "ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'project' NOT NULL"
            )
        )
        conn.execute(
            text(
                "ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS report_input_version INTEGER DEFAULT 1 NOT NULL"
            )
        )
        conn.execute(
            text(
                "ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS source_project_version INTEGER DEFAULT 1 NOT NULL"
            )
        )
        conn.execute(
            text("ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS county TEXT")
        )
        conn.execute(
            text(
                "ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS finance_state JSONB"
            )
        )
        conn.execute(
            text(
                "ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS map_snapshot JSONB"
            )
        )
        conn.execute(
            text(
                "ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS current_yard_zone TEXT"
            )
        )
        conn.execute(
            text(
                "ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS adu_clearances JSONB"
            )
        )
        conn.execute(
            text(
                "ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS adu_width_ft DOUBLE PRECISION"
            )
        )
        conn.execute(
            text(
                "ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS adu_length_ft DOUBLE PRECISION"
            )
        )
        conn.execute(
            text(
                "ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS home_sqft DOUBLE PRECISION"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_projects_status ON public.projects(status)"
            )
        )

        # ── Step 3: Rename listings -> published_listings (backward compat) ──
        # Only rename if old table exists and new one doesn't
        conn.execute(
            text("""
            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'listings')
                   AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'published_listings')
                THEN
                    ALTER TABLE public.listings RENAME TO published_listings;
                END IF;
            END $$
        """)
        )

        # Create published_listings if it doesn't exist yet (fresh installs)
        conn.execute(
            text("""
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
                created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL,
                view_count INTEGER DEFAULT 0 NOT NULL,
                save_count INTEGER DEFAULT 0 NOT NULL
            )
        """)
        )

        # Ensure backward-compat columns exist
        conn.execute(
            text(
                "ALTER TABLE public.published_listings ADD COLUMN IF NOT EXISTS project_id TEXT"
            )
        )
        conn.execute(
            text(
                "ALTER TABLE public.published_listings ADD COLUMN IF NOT EXISTS save_count INTEGER DEFAULT 0 NOT NULL"
            )
        )

        # Update saved_listings FK if it still points to old table
        # (ALTER TABLE RENAME carries FKs automatically, but update the constraint name for clarity)
        conn.execute(
            text("""
            CREATE INDEX IF NOT EXISTS ix_published_listings_project_id ON public.published_listings(project_id)
        """)
        )
        conn.execute(
            text("""
            CREATE INDEX IF NOT EXISTS ix_published_listings_seller_id ON public.published_listings(seller_id)
        """)
        )
        conn.execute(
            text("""
            CREATE INDEX IF NOT EXISTS ix_published_listings_city ON public.published_listings(city)
        """)
        )
        conn.execute(
            text("""
            CREATE INDEX IF NOT EXISTS ix_published_listings_monthly_rent ON public.published_listings(monthly_rent)
        """)
        )

        # ── Step 4: Migrate existing listing drafts into drafts table ──
        # Only for rows that still have a 'status' column from the old schema
        has_status_col = conn.execute(
            text("""
            SELECT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'published_listings'
                  AND column_name = 'status'
            )
        """)
        ).scalar()

        if has_status_col:
            conn.execute(
                text("""
                INSERT INTO public.drafts (id, project_id, seller_id, version, draft_payload, field_meta, created_at, updated_at)
                SELECT
                    l.id,
                    l.project_id,
                    l.seller_id,
                    1,
                    COALESCE(l.draft_payload, '{}'::jsonb),
                    COALESCE(l.field_meta, '{}'::jsonb),
                    l.created_at,
                    l.updated_at
                FROM public.published_listings l
                WHERE l.status = 'draft'
                  AND l.project_id IS NOT NULL
                  AND NOT EXISTS (
                      SELECT 1 FROM public.drafts d WHERE d.project_id = l.project_id
                  )
                ON CONFLICT (project_id) DO NOTHING
            """)
            )

        # ── Step 5: Set project statuses based on existing data ──
        conn.execute(
            text("""
            UPDATE public.projects p
            SET status = 'published'
            WHERE p.status = 'new'
              AND EXISTS (
                  SELECT 1 FROM public.published_listings l
                  WHERE l.project_id = p.id
              )
        """)
        )

        conn.execute(
            text("""
            UPDATE public.projects p
            SET status = 'project'
            WHERE p.status = 'new'
              AND EXISTS (
                  SELECT 1 FROM public.drafts d WHERE d.project_id = p.id
              )
        """)
        )

        conn.execute(
            text(
                "UPDATE public.projects SET status = 'project' WHERE status IN ('new', 'report', 'draft')"
            )
        )

        # ── Step 6: Create rate-limiting tables (startup-safe additive DDL only) ──
        ensure_rate_limit_startup_schema(conn)

        # ── Step 7: Create feedback table if it doesn't exist ──
        conn.execute(
            text("""
            CREATE TABLE IF NOT EXISTS public.feedback (
                id TEXT PRIMARY KEY,
                user_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
                email TEXT NOT NULL,
                topic TEXT NOT NULL,
                message TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'new',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL
            )
        """)
        )

        # Additive: ensure status column exists on pre-existing feedback tables.
        conn.execute(
            text(
                "ALTER TABLE public.feedback "
                "ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'new'"
            )
        )

    logger.info(
        "Database schema sync complete (published_listings, drafts, project statuses, rate limiting)."
    )


def get_db():
    """Dependency injection generator for database sessions."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
