-- Phase 2: company tenancy foundation.
-- Existing data is assigned to one default company so a first owner can claim it
-- through the bootstrap endpoint after logging in.

CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  legal_name TEXT,
  logo_url TEXT,
  address TEXT,
  phone TEXT,
  email TEXT,
  website TEXT,
  license_number TEXT,
  quote_terms TEXT,
  quote_footer TEXT,
  default_tax_rate NUMERIC(7,4) NOT NULL DEFAULT 0,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS company_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member'
    CHECK (role IN ('owner', 'admin', 'member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_company_members_user_id ON company_members(user_id);
CREATE INDEX IF NOT EXISTS idx_company_members_company_id ON company_members(company_id);

CREATE OR REPLACE FUNCTION public.update_company_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_companies_updated_at ON companies;
CREATE TRIGGER set_companies_updated_at
  BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION public.update_company_updated_at();

CREATE OR REPLACE FUNCTION public.is_company_member(target_company_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM company_members
    WHERE company_id = target_company_id
      AND user_id = auth.uid()
  );
$$;

ALTER TABLE clients ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE openings ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE measurements ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE extraction_runs ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE takeoff_sessions ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE takeoff_regions ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_clients_company_id ON clients(company_id);
CREATE INDEX IF NOT EXISTS idx_projects_company_id ON projects(company_id);
CREATE INDEX IF NOT EXISTS idx_documents_company_id ON documents(company_id);
CREATE INDEX IF NOT EXISTS idx_quotes_company_id ON quotes(company_id);
CREATE INDEX IF NOT EXISTS idx_settings_company_key ON settings(company_id, key);
CREATE INDEX IF NOT EXISTS idx_rooms_company_id ON rooms(company_id);
CREATE INDEX IF NOT EXISTS idx_openings_company_id ON openings(company_id);
CREATE INDEX IF NOT EXISTS idx_measurements_company_id ON measurements(company_id);
CREATE INDEX IF NOT EXISTS idx_extraction_runs_company_id ON extraction_runs(company_id);
CREATE INDEX IF NOT EXISTS idx_takeoff_sessions_company_id ON takeoff_sessions(company_id);
CREATE INDEX IF NOT EXISTS idx_takeoff_regions_company_id ON takeoff_regions(company_id);

ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_key_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_company_key_unique ON settings(company_id, key);

WITH default_company AS (
  INSERT INTO companies (name, legal_name, email)
  SELECT 'East Valley Insulation', 'East Valley Insulation LLC', 'info@eastvalleyinsulation.com'
  WHERE NOT EXISTS (SELECT 1 FROM companies)
  RETURNING id
),
target_company AS (
  SELECT id FROM default_company
  UNION ALL
  SELECT id FROM companies ORDER BY id LIMIT 1
)
UPDATE clients SET company_id = (SELECT id FROM target_company) WHERE company_id IS NULL;

WITH target_company AS (SELECT id FROM companies ORDER BY created_at, id LIMIT 1)
UPDATE projects SET company_id = (SELECT id FROM target_company) WHERE company_id IS NULL;

UPDATE documents d
SET company_id = p.company_id
FROM projects p
WHERE d.project_id = p.id
  AND d.company_id IS NULL;

UPDATE quotes q
SET company_id = p.company_id
FROM projects p
WHERE q.project_id = p.id
  AND q.company_id IS NULL;

WITH target_company AS (SELECT id FROM companies ORDER BY created_at, id LIMIT 1)
UPDATE settings SET company_id = (SELECT id FROM target_company) WHERE company_id IS NULL;

UPDATE rooms r
SET company_id = p.company_id
FROM projects p
WHERE r.project_id = p.id
  AND r.company_id IS NULL;

UPDATE openings o
SET company_id = p.company_id
FROM projects p
WHERE o.project_id = p.id
  AND o.company_id IS NULL;

UPDATE measurements m
SET company_id = r.company_id
FROM rooms r
WHERE m.room_id = r.id
  AND m.company_id IS NULL;

UPDATE extraction_runs er
SET company_id = p.company_id
FROM projects p
WHERE er.project_id = p.id
  AND er.company_id IS NULL;

UPDATE takeoff_sessions ts
SET company_id = p.company_id
FROM projects p
WHERE ts.project_id = p.id
  AND ts.company_id IS NULL;

UPDATE takeoff_regions tr
SET company_id = ts.company_id
FROM takeoff_sessions ts
WHERE tr.session_id = ts.id
  AND tr.company_id IS NULL;

ALTER TABLE clients ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE projects ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE documents ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE quotes ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE settings ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE rooms ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE openings ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE measurements ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE extraction_runs ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE takeoff_sessions ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE takeoff_regions ALTER COLUMN company_id SET NOT NULL;

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE openings ENABLE ROW LEVEL SECURITY;
ALTER TABLE measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE extraction_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE takeoff_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE takeoff_regions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all operations on projects" ON projects;
DROP POLICY IF EXISTS "Allow all operations on rooms" ON rooms;
DROP POLICY IF EXISTS "Allow all operations on measurements" ON measurements;
DROP POLICY IF EXISTS "Allow all operations on quotes" ON quotes;
DROP POLICY IF EXISTS "Allow all operations on settings" ON settings;
DROP POLICY IF EXISTS "allow_all_takeoff_sessions" ON takeoff_sessions;
DROP POLICY IF EXISTS "allow_all_takeoff_regions" ON takeoff_regions;
DROP POLICY IF EXISTS "Allow all access to extraction_runs" ON extraction_runs;
DROP POLICY IF EXISTS "allow_all_extraction_runs" ON extraction_runs;

DROP POLICY IF EXISTS "companies_member_access" ON companies;
DROP POLICY IF EXISTS "company_members_self_select" ON company_members;
DROP POLICY IF EXISTS "company_scoped_clients" ON clients;
DROP POLICY IF EXISTS "company_scoped_projects" ON projects;
DROP POLICY IF EXISTS "company_scoped_documents" ON documents;
DROP POLICY IF EXISTS "company_scoped_quotes" ON quotes;
DROP POLICY IF EXISTS "company_scoped_settings" ON settings;
DROP POLICY IF EXISTS "company_scoped_rooms" ON rooms;
DROP POLICY IF EXISTS "company_scoped_openings" ON openings;
DROP POLICY IF EXISTS "company_scoped_measurements" ON measurements;
DROP POLICY IF EXISTS "company_scoped_extraction_runs" ON extraction_runs;
DROP POLICY IF EXISTS "company_scoped_takeoff_sessions" ON takeoff_sessions;
DROP POLICY IF EXISTS "company_scoped_takeoff_regions" ON takeoff_regions;

CREATE POLICY "companies_member_access"
  ON companies FOR ALL
  USING (public.is_company_member(id))
  WITH CHECK (public.is_company_member(id));

CREATE POLICY "company_members_self_select"
  ON company_members FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "company_scoped_clients"
  ON clients FOR ALL
  USING (public.is_company_member(company_id))
  WITH CHECK (public.is_company_member(company_id));

CREATE POLICY "company_scoped_projects"
  ON projects FOR ALL
  USING (public.is_company_member(company_id))
  WITH CHECK (public.is_company_member(company_id));

CREATE POLICY "company_scoped_documents"
  ON documents FOR ALL
  USING (public.is_company_member(company_id))
  WITH CHECK (public.is_company_member(company_id));

CREATE POLICY "company_scoped_quotes"
  ON quotes FOR ALL
  USING (public.is_company_member(company_id))
  WITH CHECK (public.is_company_member(company_id));

CREATE POLICY "company_scoped_settings"
  ON settings FOR ALL
  USING (public.is_company_member(company_id))
  WITH CHECK (public.is_company_member(company_id));

CREATE POLICY "company_scoped_rooms"
  ON rooms FOR ALL
  USING (public.is_company_member(company_id))
  WITH CHECK (public.is_company_member(company_id));

CREATE POLICY "company_scoped_openings"
  ON openings FOR ALL
  USING (public.is_company_member(company_id))
  WITH CHECK (public.is_company_member(company_id));

CREATE POLICY "company_scoped_measurements"
  ON measurements FOR ALL
  USING (public.is_company_member(company_id))
  WITH CHECK (public.is_company_member(company_id));

CREATE POLICY "company_scoped_extraction_runs"
  ON extraction_runs FOR ALL
  USING (public.is_company_member(company_id))
  WITH CHECK (public.is_company_member(company_id));

CREATE POLICY "company_scoped_takeoff_sessions"
  ON takeoff_sessions FOR ALL
  USING (public.is_company_member(company_id))
  WITH CHECK (public.is_company_member(company_id));

CREATE POLICY "company_scoped_takeoff_regions"
  ON takeoff_regions FOR ALL
  USING (public.is_company_member(company_id))
  WITH CHECK (public.is_company_member(company_id));
