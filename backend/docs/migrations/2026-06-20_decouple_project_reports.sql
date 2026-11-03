BEGIN;

ALTER TABLE public.projects
    ADD COLUMN IF NOT EXISTS report_input_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE public.reports
    ADD COLUMN IF NOT EXISTS source_project_version INTEGER NOT NULL DEFAULT 1;

UPDATE public.projects
SET status = 'project'
WHERE status IN ('new', 'report', 'draft');

UPDATE public.reports AS report
SET source_project_version = project.report_input_version
FROM public.projects AS project
WHERE report.project_id = project.id;

ALTER TABLE public.projects
    DROP COLUMN IF EXISTS report_preload,
    DROP COLUMN IF EXISTS report_preload_pending_jobs,
    DROP COLUMN IF EXISTS report_preload_updated_at;

COMMIT;
