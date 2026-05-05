ALTER TABLE takeoff_sessions
  ADD COLUMN IF NOT EXISTS window_catalog JSONB NOT NULL DEFAULT '[]';

COMMENT ON COLUMN takeoff_sessions.window_catalog IS 'Per-plan-set window catalog built from confirmed window size captures.';
