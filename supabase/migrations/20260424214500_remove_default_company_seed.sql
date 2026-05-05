-- Remove the old prototype seed company from fresh production installs.
-- Company workspaces are now created by the first signed-in user.

DELETE FROM companies c
WHERE c.name = 'East Valley Insulation'
  AND NOT EXISTS (SELECT 1 FROM company_members cm WHERE cm.company_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM clients cl WHERE cl.company_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.company_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.company_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM quotes q WHERE q.company_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM takeoff_sessions ts WHERE ts.company_id = c.id);
