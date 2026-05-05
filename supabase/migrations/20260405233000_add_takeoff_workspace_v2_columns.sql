ALTER TABLE takeoff_sessions
  ADD COLUMN IF NOT EXISTS workspace_schema_version INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS page_analysis JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS views JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS zones JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS wall_runs JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS surfaces JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS opening_items JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS completion_checklist JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS ai_suggestions JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS viewer_state JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS workspace_summary JSONB NOT NULL DEFAULT '{}';

COMMENT ON COLUMN takeoff_sessions.workspace_schema_version IS 'Version of the wall-object workspace schema persisted with the session.';
COMMENT ON COLUMN takeoff_sessions.page_analysis IS 'Per-page title and capability analysis used to seed the takeoff workflow.';
COMMENT ON COLUMN takeoff_sessions.views IS 'Scoped takeoff views for each source page. Multiple views can exist on the same calibrated page.';
COMMENT ON COLUMN takeoff_sessions.zones IS 'Zone polygons used for conditioned vs unconditioned adjacency.';
COMMENT ON COLUMN takeoff_sessions.wall_runs IS 'Future wall-object records for calibrated wall takeoff.';
COMMENT ON COLUMN takeoff_sessions.surfaces IS 'Area-based takeoff objects such as attic floor, crawlspace floor, and garage ceiling.';
COMMENT ON COLUMN takeoff_sessions.opening_items IS 'Openings associated with wall runs or takeoff views.';
COMMENT ON COLUMN takeoff_sessions.completion_checklist IS 'Workflow checklist proving the takeoff scope is reviewed before quote generation.';
COMMENT ON COLUMN takeoff_sessions.ai_suggestions IS 'AI-generated suggestions and warnings attached to pages or takeoff objects.';
COMMENT ON COLUMN takeoff_sessions.viewer_state IS 'Per-page viewer state including active takeoff view and ghosted overlays.';
COMMENT ON COLUMN takeoff_sessions.workspace_summary IS 'Derived quote-facing summary of calibrated takeoff quantities.';
