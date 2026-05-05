ALTER TABLE takeoff_sessions
  ADD COLUMN IF NOT EXISTS estimate_rows JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN takeoff_sessions.estimate_rows IS
  'Estimator-reviewed quote worksheet rows persisted from the takeoff summary step.';

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_quotes_company_project_idempotency
  ON quotes(company_id, project_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
