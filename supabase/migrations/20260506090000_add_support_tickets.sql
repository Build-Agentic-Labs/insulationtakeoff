-- Customer support tickets with private company-scoped screenshot attachments.

CREATE TABLE IF NOT EXISTS support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  submitter_email TEXT NOT NULL,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  page_url TEXT,
  browser_info JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'resolved')),
  notification_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (notification_status IN ('pending', 'sent', 'failed', 'skipped')),
  notification_id TEXT,
  notification_error TEXT,
  notified_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS support_ticket_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT support_attachment_company_path_check
    CHECK (storage_path LIKE ('companies/' || company_id::text || '/support/' || ticket_id::text || '/%')),
  UNIQUE (storage_path)
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_company_status
  ON support_tickets(company_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_tickets_company_created
  ON support_tickets(company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_tickets_user_id
  ON support_tickets(user_id);

CREATE INDEX IF NOT EXISTS idx_support_tickets_project_id
  ON support_tickets(project_id);

CREATE INDEX IF NOT EXISTS idx_support_ticket_attachments_ticket_id
  ON support_ticket_attachments(ticket_id);

CREATE INDEX IF NOT EXISTS idx_support_ticket_attachments_company_id
  ON support_ticket_attachments(company_id);

CREATE OR REPLACE FUNCTION public.enforce_support_ticket_project_company()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM projects
    WHERE id = NEW.project_id
      AND company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'Support ticket project must belong to the same company';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public;

DROP TRIGGER IF EXISTS enforce_support_ticket_project_company ON support_tickets;
CREATE TRIGGER enforce_support_ticket_project_company
  BEFORE INSERT OR UPDATE OF company_id, project_id ON support_tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_support_ticket_project_company();

DROP TRIGGER IF EXISTS update_support_tickets_updated_at ON support_tickets;
CREATE TRIGGER update_support_tickets_updated_at
  BEFORE UPDATE ON support_tickets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_ticket_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "support_tickets_member_insert" ON support_tickets;
DROP POLICY IF EXISTS "support_tickets_submitter_select" ON support_tickets;
DROP POLICY IF EXISTS "support_tickets_admin_select" ON support_tickets;
DROP POLICY IF EXISTS "support_tickets_admin_update" ON support_tickets;
DROP POLICY IF EXISTS "support_tickets_admin_delete" ON support_tickets;

CREATE POLICY "support_tickets_member_insert"
  ON support_tickets FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND public.is_company_member(company_id)
  );

CREATE POLICY "support_tickets_submitter_select"
  ON support_tickets FOR SELECT
  USING (
    user_id = auth.uid()
    AND public.is_company_member(company_id)
  );

CREATE POLICY "support_tickets_admin_select"
  ON support_tickets FOR SELECT
  USING (public.is_company_admin(company_id));

CREATE POLICY "support_tickets_admin_update"
  ON support_tickets FOR UPDATE
  USING (public.is_company_admin(company_id))
  WITH CHECK (public.is_company_admin(company_id));

CREATE POLICY "support_tickets_admin_delete"
  ON support_tickets FOR DELETE
  USING (public.is_company_admin(company_id));

DROP POLICY IF EXISTS "support_ticket_attachments_member_insert" ON support_ticket_attachments;
DROP POLICY IF EXISTS "support_ticket_attachments_company_select" ON support_ticket_attachments;
DROP POLICY IF EXISTS "support_ticket_attachments_admin_update" ON support_ticket_attachments;
DROP POLICY IF EXISTS "support_ticket_attachments_admin_delete" ON support_ticket_attachments;

CREATE POLICY "support_ticket_attachments_member_insert"
  ON support_ticket_attachments FOR INSERT
  WITH CHECK (
    public.is_company_member(company_id)
    AND EXISTS (
      SELECT 1
      FROM support_tickets
      WHERE support_tickets.id = support_ticket_attachments.ticket_id
        AND support_tickets.company_id = support_ticket_attachments.company_id
    )
  );

CREATE POLICY "support_ticket_attachments_company_select"
  ON support_ticket_attachments FOR SELECT
  USING (public.is_company_member(company_id));

CREATE POLICY "support_ticket_attachments_admin_update"
  ON support_ticket_attachments FOR UPDATE
  USING (public.is_company_admin(company_id))
  WITH CHECK (public.is_company_admin(company_id));

CREATE POLICY "support_ticket_attachments_admin_delete"
  ON support_ticket_attachments FOR DELETE
  USING (public.is_company_admin(company_id));
