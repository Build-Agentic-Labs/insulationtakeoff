-- Takeoff sessions: one per document being analyzed
CREATE TABLE takeoff_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'completed', 'abandoned')),
  selected_pages INTEGER[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Takeoff regions: one per wall section analyzed
CREATE TABLE takeoff_regions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES takeoff_sessions(id) ON DELETE CASCADE,
  page_index INTEGER NOT NULL,
  label TEXT NOT NULL,
  wall_type TEXT NOT NULL DEFAULT 'exterior'
    CHECK (wall_type IN ('exterior', 'garage', 'basement', 'other')),
  source TEXT NOT NULL DEFAULT 'ai'
    CHECK (source IN ('ai', 'manual')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'analyzing', 'confirmed', 'rejected')),
  bbox JSONB NOT NULL,
  wall_length_lf REAL,
  wall_height_ft REAL,
  gross_sf REAL,
  net_sf REAL,
  openings JSONB DEFAULT '[]',
  raw_ocr_result JSONB,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_takeoff_sessions_project ON takeoff_sessions(project_id);
CREATE INDEX idx_takeoff_sessions_document ON takeoff_sessions(document_id);
CREATE INDEX idx_takeoff_regions_session ON takeoff_regions(session_id);

-- RLS (permissive for now, matching existing pattern)
ALTER TABLE takeoff_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE takeoff_regions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_takeoff_sessions" ON takeoff_sessions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_takeoff_regions" ON takeoff_regions FOR ALL USING (true) WITH CHECK (true);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_takeoff_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_takeoff_sessions_updated_at
  BEFORE UPDATE ON takeoff_sessions
  FOR EACH ROW EXECUTE FUNCTION update_takeoff_updated_at();
