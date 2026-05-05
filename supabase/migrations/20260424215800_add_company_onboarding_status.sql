ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;

COMMENT ON COLUMN companies.onboarding_completed IS 'True once the company has completed the first-use company profile setup.';
COMMENT ON COLUMN companies.onboarding_completed_at IS 'Timestamp when first-use company setup was completed.';
