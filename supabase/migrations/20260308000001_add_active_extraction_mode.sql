-- Add active_extraction_mode to projects table
-- Persists which extraction source (ocr/vision) the user has selected
-- so the choice is deterministic across refreshes and users.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS active_extraction_mode TEXT DEFAULT NULL;

-- Allowed values: 'ocr', 'vision', or NULL (auto-detect)
COMMENT ON COLUMN projects.active_extraction_mode IS
  'User-selected extraction mode for review/quote pages. NULL = auto-detect.';
