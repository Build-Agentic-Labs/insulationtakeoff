-- M8.1: Add takeoff_envelope JSONB column to documents table
-- Stores the canonical TakeoffEnvelopeV1 from pdfengine OCR pipeline
ALTER TABLE documents ADD COLUMN IF NOT EXISTS takeoff_envelope jsonb DEFAULT NULL;

-- Partial index: speeds up queries filtering documents with envelope data by project
CREATE INDEX IF NOT EXISTS idx_documents_has_envelope
  ON documents (project_id)
  WHERE takeoff_envelope IS NOT NULL;

COMMENT ON COLUMN documents.takeoff_envelope IS 'TakeoffEnvelopeV1 JSON from pdfengine OCR pipeline. Null if only Vision extraction was used.';
