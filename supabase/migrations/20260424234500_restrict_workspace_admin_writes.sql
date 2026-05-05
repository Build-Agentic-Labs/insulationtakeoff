-- Restrict workspace-level writes to owners/admins while preserving member reads.

CREATE OR REPLACE FUNCTION public.is_company_admin(target_company_id UUID)
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
      AND role IN ('owner', 'admin')
  );
$$;

DROP POLICY IF EXISTS "companies_member_access" ON companies;
DROP POLICY IF EXISTS "companies_member_select" ON companies;
DROP POLICY IF EXISTS "companies_admin_insert" ON companies;
DROP POLICY IF EXISTS "companies_admin_update" ON companies;
DROP POLICY IF EXISTS "companies_admin_delete" ON companies;

CREATE POLICY "companies_member_select"
  ON companies FOR SELECT
  USING (public.is_company_member(id));

CREATE POLICY "companies_admin_insert"
  ON companies FOR INSERT
  WITH CHECK (public.is_company_admin(id));

CREATE POLICY "companies_admin_update"
  ON companies FOR UPDATE
  USING (public.is_company_admin(id))
  WITH CHECK (public.is_company_admin(id));

CREATE POLICY "companies_admin_delete"
  ON companies FOR DELETE
  USING (public.is_company_admin(id));

DROP POLICY IF EXISTS "company_scoped_settings" ON settings;
DROP POLICY IF EXISTS "settings_member_select" ON settings;
DROP POLICY IF EXISTS "settings_admin_insert" ON settings;
DROP POLICY IF EXISTS "settings_admin_update" ON settings;
DROP POLICY IF EXISTS "settings_admin_delete" ON settings;

CREATE POLICY "settings_member_select"
  ON settings FOR SELECT
  USING (public.is_company_member(company_id));

CREATE POLICY "settings_admin_insert"
  ON settings FOR INSERT
  WITH CHECK (public.is_company_admin(company_id));

CREATE POLICY "settings_admin_update"
  ON settings FOR UPDATE
  USING (public.is_company_admin(company_id))
  WITH CHECK (public.is_company_admin(company_id));

CREATE POLICY "settings_admin_delete"
  ON settings FOR DELETE
  USING (public.is_company_admin(company_id));
