-- Production storage hardening.
-- Keep all uploaded assets in company-scoped folders and make direct storage
-- object access depend on active company membership.

INSERT INTO storage.buckets (id, name, public)
VALUES ('pdfs', 'pdfs', false)
ON CONFLICT (id) DO UPDATE SET public = false;

CREATE OR REPLACE FUNCTION public.storage_company_id(object_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  parts TEXT[];
BEGIN
  parts := storage.foldername(object_name);

  IF array_length(parts, 1) < 2 OR parts[1] <> 'companies' THEN
    RETURN NULL;
  END IF;

  RETURN parts[2]::UUID;
EXCEPTION
  WHEN invalid_text_representation THEN
    RETURN NULL;
END;
$$;

DROP POLICY IF EXISTS "company_storage_select" ON storage.objects;
DROP POLICY IF EXISTS "company_storage_insert" ON storage.objects;
DROP POLICY IF EXISTS "company_storage_update" ON storage.objects;
DROP POLICY IF EXISTS "company_storage_delete" ON storage.objects;

CREATE POLICY "company_storage_select"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'pdfs'
    AND public.is_company_member(public.storage_company_id(name))
  );

CREATE POLICY "company_storage_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'pdfs'
    AND public.is_company_member(public.storage_company_id(name))
  );

CREATE POLICY "company_storage_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'pdfs'
    AND public.is_company_member(public.storage_company_id(name))
  )
  WITH CHECK (
    bucket_id = 'pdfs'
    AND public.is_company_member(public.storage_company_id(name))
  );

CREATE POLICY "company_storage_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'pdfs'
    AND public.is_company_member(public.storage_company_id(name))
  );

UPDATE companies
SET logo_url = regexp_replace(
  logo_url,
  '^.*\/storage\/v1\/object\/public\/pdfs\/([^?]+)(\?.*)?$',
  '/api/storage/file?path=\1'
)
WHERE logo_url LIKE '%/storage/v1/object/public/pdfs/companies/%';

UPDATE projects
SET pdf_url = regexp_replace(
  pdf_url,
  '^.*\/storage\/v1\/object\/public\/pdfs\/([^?]+)(\?.*)?$',
  '/api/storage/file?path=\1'
)
WHERE pdf_url LIKE '%/storage/v1/object/public/pdfs/companies/%';

UPDATE documents
SET file_url = regexp_replace(
  file_url,
  '^.*\/storage\/v1\/object\/public\/pdfs\/([^?]+)(\?.*)?$',
  '/api/storage/file?path=\1'
)
WHERE file_url LIKE '%/storage/v1/object/public/pdfs/companies/%';

UPDATE quotes
SET pdf_url = regexp_replace(
  pdf_url,
  '^.*\/storage\/v1\/object\/public\/pdfs\/([^?]+)(\?.*)?$',
  '/api/storage/file?path=\1'
)
WHERE pdf_url LIKE '%/storage/v1/object/public/pdfs/companies/%';
