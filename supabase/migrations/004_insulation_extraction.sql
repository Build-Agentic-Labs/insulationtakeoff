-- Add insulation-specific columns to rooms table
ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS wall_sf numeric,
  ADD COLUMN IF NOT EXISTS floor_sf numeric,
  ADD COLUMN IF NOT EXISTS ceiling_sf numeric,
  ADD COLUMN IF NOT EXISTS wall_composition text,
  ADD COLUMN IF NOT EXISTS stud_size text;

-- Create openings table for doors and windows
CREATE TABLE IF NOT EXISTS openings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  type text NOT NULL CHECK (type IN ('door', 'window')),
  label text NOT NULL DEFAULT '',
  width_ft numeric,
  height_ft numeric,
  area_sqft numeric,
  count integer DEFAULT 1,
  confidence numeric,
  created_at timestamptz DEFAULT now()
);

-- Index for fast lookups by project
CREATE INDEX IF NOT EXISTS idx_openings_project_id ON openings(project_id);

-- Enable RLS
ALTER TABLE openings ENABLE ROW LEVEL SECURITY;

-- Permissive policy (matches existing pattern)
CREATE POLICY "Allow all access to openings" ON openings
  FOR ALL USING (true) WITH CHECK (true);
