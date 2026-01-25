-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Projects table
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  pdf_url TEXT NOT NULL,
  status TEXT DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'extracting', 'reviewing', 'completed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Rooms table
CREATE TABLE rooms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('living', 'garage', 'attic', 'crawlspace')),
  area_sqft DECIMAL(10,2),
  perimeter_ft DECIMAL(10,2),
  height_ft DECIMAL(10,2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Measurements table
CREATE TABLE measurements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
  field TEXT NOT NULL,
  extracted_value DECIMAL(10,2),
  user_override DECIMAL(10,2),
  source_page INTEGER,
  bbox JSONB,
  confidence DECIMAL(3,2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Quotes table
CREATE TABLE quotes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  line_items JSONB NOT NULL,
  total_cost DECIMAL(10,2) NOT NULL,
  pdf_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Settings table
CREATE TABLE settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key TEXT UNIQUE NOT NULL,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_rooms_project_id ON rooms(project_id);
CREATE INDEX idx_measurements_room_id ON measurements(room_id);
CREATE INDEX idx_quotes_project_id ON quotes(project_id);
CREATE INDEX idx_settings_key ON settings(key);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_settings_updated_at
  BEFORE UPDATE ON settings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Insert default settings
INSERT INTO settings (key, value) VALUES
  ('r_values', '{
    "wall": null,
    "attic": null,
    "garage_wall": null,
    "floor": null
  }'::jsonb),
  ('pricing', '{
    "wall_per_sqft": 1.50,
    "attic_per_sqft": 2.00,
    "garage_wall_per_sqft": 1.75,
    "floor_per_sqft": 2.50
  }'::jsonb);

-- Row Level Security (RLS)
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

-- Policies (for now, allow all operations - add auth later)
CREATE POLICY "Allow all operations on projects" ON projects FOR ALL USING (true);
CREATE POLICY "Allow all operations on rooms" ON rooms FOR ALL USING (true);
CREATE POLICY "Allow all operations on measurements" ON measurements FOR ALL USING (true);
CREATE POLICY "Allow all operations on quotes" ON quotes FOR ALL USING (true);
CREATE POLICY "Allow all operations on settings" ON settings FOR ALL USING (true);
