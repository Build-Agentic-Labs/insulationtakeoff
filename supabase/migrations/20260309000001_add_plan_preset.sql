-- Add plan_preset column to projects table
-- Stores the canonical pdfengine plan config key (e.g., "Gamache", "Eddie")
-- NULL means "Auto / Unknown" (use default config)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS plan_preset text DEFAULT NULL;
