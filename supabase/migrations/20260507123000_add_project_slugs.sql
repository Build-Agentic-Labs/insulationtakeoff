ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS slug TEXT;

WITH base_slugs AS (
  SELECT
    id,
    company_id,
    COALESCE(
      NULLIF(
        LEFT(TRIM(BOTH '-' FROM REGEXP_REPLACE(LOWER(name), '[^a-z0-9]+', '-', 'g')), 80),
        ''
      ),
      'project'
    ) AS slug_candidate,
    created_at
  FROM public.projects
  WHERE slug IS NULL OR slug = ''
),
ranked AS (
  SELECT
    id,
    CASE
      WHEN ROW_NUMBER() OVER (PARTITION BY company_id, slug_candidate ORDER BY created_at, id) = 1
        THEN slug_candidate
      ELSE
        LEFT(slug_candidate, 72) || '-' ||
        ROW_NUMBER() OVER (PARTITION BY company_id, slug_candidate ORDER BY created_at, id)::TEXT
    END AS next_slug
  FROM base_slugs
)
UPDATE public.projects AS projects
SET slug = ranked.next_slug
FROM ranked
WHERE projects.id = ranked.id;

CREATE UNIQUE INDEX IF NOT EXISTS projects_company_id_slug_key
  ON public.projects(company_id, slug)
  WHERE slug IS NOT NULL;
