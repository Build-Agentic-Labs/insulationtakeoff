ALTER TABLE takeoff_sessions
  ADD COLUMN IF NOT EXISTS door_catalog JSONB NOT NULL DEFAULT '[]';

COMMENT ON COLUMN takeoff_sessions.door_catalog IS 'Per-plan-set door catalog built from confirmed door size captures.';
