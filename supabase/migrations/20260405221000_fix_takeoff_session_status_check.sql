ALTER TABLE takeoff_sessions
  DROP CONSTRAINT IF EXISTS takeoff_sessions_status_check;

ALTER TABLE takeoff_sessions
  ADD CONSTRAINT takeoff_sessions_status_check
  CHECK (
    status IN (
      'in_progress',
      'calibrating',
      'tracing',
      'reviewing',
      'completed',
      'abandoned'
    )
  );
