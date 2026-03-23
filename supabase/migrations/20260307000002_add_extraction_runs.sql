-- M8.3A: ExtractionRuns table for idempotency + audit + metrics
CREATE TABLE IF NOT EXISTS extraction_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('ocr', 'vision', 'hybrid')),
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'started' CHECK (status IN ('started', 'complete', 'review', 'failed')),
  attempt INT NOT NULL DEFAULT 1,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  error TEXT,
  takeoff_envelope JSONB,
  metrics_json JSONB,
  request_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_extraction_runs_idempotency UNIQUE (project_id, idempotency_key)
);

-- Fast lookups: recent runs per project
CREATE INDEX IF NOT EXISTS idx_extraction_runs_project_created
  ON extraction_runs (project_id, created_at DESC);

COMMENT ON TABLE extraction_runs IS 'Audit trail for extraction attempts. Idempotency enforced by (project_id, idempotency_key).';
COMMENT ON COLUMN extraction_runs.metrics_json IS 'Future: OCR vs Vision comparison metrics, quality scores, etc.';
COMMENT ON COLUMN extraction_runs.request_json IS 'Capture of request params: mode, page overrides, plan_name, etc.';

-- RLS: match existing pattern (open access, auth added later)
ALTER TABLE extraction_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to extraction_runs" ON extraction_runs
  FOR ALL USING (true) WITH CHECK (true);

-- Auto-update updated_at (reuse existing trigger function from 001)
CREATE TRIGGER update_extraction_runs_updated_at
  BEFORE UPDATE ON extraction_runs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
