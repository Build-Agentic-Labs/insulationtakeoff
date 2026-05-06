-- Threaded messages for support tickets, including in-app replies and inbound email replies.

CREATE TABLE IF NOT EXISTS support_ticket_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  author_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  author_email TEXT NOT NULL,
  author_role TEXT NOT NULL
    CHECK (author_role IN ('customer', 'support', 'system')),
  body TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'app'
    CHECK (source IN ('app', 'email')),
  inbound_email_id TEXT UNIQUE,
  inbound_message_id TEXT,
  outbound_email_id TEXT,
  notification_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (notification_status IN ('pending', 'sent', 'failed', 'skipped')),
  notification_error TEXT,
  notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT support_ticket_messages_company_check
    CHECK (company_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_support_ticket_messages_ticket_created
  ON support_ticket_messages(ticket_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_support_ticket_messages_company_created
  ON support_ticket_messages(company_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.enforce_support_ticket_message_company()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM support_tickets
    WHERE support_tickets.id = NEW.ticket_id
      AND support_tickets.company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'Support ticket message must belong to the same company as its ticket';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public;

DROP TRIGGER IF EXISTS enforce_support_ticket_message_company ON support_ticket_messages;
CREATE TRIGGER enforce_support_ticket_message_company
  BEFORE INSERT OR UPDATE OF company_id, ticket_id ON support_ticket_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_support_ticket_message_company();

INSERT INTO support_ticket_messages (
  ticket_id,
  company_id,
  author_user_id,
  author_email,
  author_role,
  body,
  source,
  outbound_email_id,
  notification_status,
  notification_error,
  notified_at,
  created_at
)
SELECT
  support_tickets.id,
  support_tickets.company_id,
  support_tickets.user_id,
  support_tickets.submitter_email,
  'customer',
  support_tickets.message,
  'app',
  support_tickets.notification_id,
  support_tickets.notification_status,
  support_tickets.notification_error,
  support_tickets.notified_at,
  support_tickets.created_at
FROM support_tickets
WHERE NOT EXISTS (
  SELECT 1
  FROM support_ticket_messages
  WHERE support_ticket_messages.ticket_id = support_tickets.id
    AND support_ticket_messages.author_role = 'customer'
    AND support_ticket_messages.source = 'app'
    AND support_ticket_messages.created_at = support_tickets.created_at
);

ALTER TABLE support_ticket_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "support_ticket_messages_submitter_select" ON support_ticket_messages;
DROP POLICY IF EXISTS "support_ticket_messages_admin_select" ON support_ticket_messages;
DROP POLICY IF EXISTS "support_ticket_messages_submitter_insert" ON support_ticket_messages;
DROP POLICY IF EXISTS "support_ticket_messages_admin_insert" ON support_ticket_messages;
DROP POLICY IF EXISTS "support_ticket_messages_admin_delete" ON support_ticket_messages;

CREATE POLICY "support_ticket_messages_submitter_select"
  ON support_ticket_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM support_tickets
      WHERE support_tickets.id = support_ticket_messages.ticket_id
        AND support_tickets.company_id = support_ticket_messages.company_id
        AND support_tickets.user_id = auth.uid()
        AND public.is_company_member(support_ticket_messages.company_id)
    )
  );

CREATE POLICY "support_ticket_messages_admin_select"
  ON support_ticket_messages FOR SELECT
  USING (public.is_company_admin(company_id));

CREATE POLICY "support_ticket_messages_submitter_insert"
  ON support_ticket_messages FOR INSERT
  WITH CHECK (
    author_user_id = auth.uid()
    AND author_role = 'customer'
    AND source = 'app'
    AND EXISTS (
      SELECT 1
      FROM support_tickets
      WHERE support_tickets.id = support_ticket_messages.ticket_id
        AND support_tickets.company_id = support_ticket_messages.company_id
        AND support_tickets.user_id = auth.uid()
        AND public.is_company_member(support_ticket_messages.company_id)
    )
  );

CREATE POLICY "support_ticket_messages_admin_insert"
  ON support_ticket_messages FOR INSERT
  WITH CHECK (
    author_user_id = auth.uid()
    AND author_role = 'support'
    AND source = 'app'
    AND public.is_company_admin(company_id)
  );

CREATE POLICY "support_ticket_messages_admin_delete"
  ON support_ticket_messages FOR DELETE
  USING (public.is_company_admin(company_id));
