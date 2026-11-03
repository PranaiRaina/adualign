BEGIN;

ALTER TABLE public.projects
    ALTER COLUMN status SET DEFAULT 'project';

UPDATE public.projects
SET status = 'project'
WHERE status = 'draft';

COMMIT;
