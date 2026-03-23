-- M8.1: Add takeoff_envelope JSONB column to documents table
-- Stores the canonical TakeoffEnvelopeV1 from pdfengine OCR pipeline
ALTER TABLE documents ADD COLUMN IF NOT EXISTS takeoff_envelope jsonb DEFAULT NULL;

-- Partial index: speeds up queries filtering documents with envelope data by project
CREATE INDEX IF NOT EXISTS idx_documents_has_envelope
  ON documents (project_id)
  WHERE takeoff_envelope IS NOT NULL;

COMMENT ON COLUMN documents.takeoff_envelope IS 'TakeoffEnvelopeV1 JSON from pdfengine OCR pipeline. Null if only Vision extraction was used.';

-- Ensure documents has RLS + open policy (was missing from 003_add_documents.sql)
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'documents' AND policyname = 'Allow all access to documents'
  ) THEN
    CREATE POLICY "Allow all access to documents" ON documents FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
