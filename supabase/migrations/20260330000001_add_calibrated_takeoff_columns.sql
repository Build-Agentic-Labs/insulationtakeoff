-- Add calibrated takeoff columns to takeoff_sessions
-- These store the new geometry-based measurement data (calibrations, traces, classifications)

ALTER TABLE takeoff_sessions
  ADD COLUMN IF NOT EXISTS measurement_basis TEXT DEFAULT 'exterior_face',
  ADD COLUMN IF NOT EXISTS calibrations JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS traces JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS classifications JSONB DEFAULT '[]';

-- Update status enum to match new workflow
-- Old: 'in_progress' | 'completed' | 'abandoned'
-- New: 'calibrating' | 'tracing' | 'reviewing' | 'completed'
-- We keep old values valid and add new ones (status is a text column, not an enum)

-- Migrate existing in_progress sessions to calibrating
UPDATE takeoff_sessions
  SET status = 'calibrating'
  WHERE status = 'in_progress';

COMMENT ON COLUMN takeoff_sessions.measurement_basis IS 'What the traces measure: exterior_face, stud_line, centerline, sheathing_line';
COMMENT ON COLUMN takeoff_sessions.calibrations IS 'Per-page calibration data keyed by page index: { "0": { primary, verification, pdfPointsPerFoot, ... } }';
COMMENT ON COLUMN takeoff_sessions.traces IS 'Array of traced geometry: [{ id, pageIndex, type, points, isClosed, isLocked, label }]';
COMMENT ON COLUMN takeoff_sessions.classifications IS 'Per-segment classification: [{ traceId, segmentIndex, assemblyScope, wallHeightFt, openings, ... }]';
