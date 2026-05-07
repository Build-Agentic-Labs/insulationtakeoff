ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS default_tax_rate NUMERIC(7,4) NOT NULL DEFAULT 0;

UPDATE companies
SET default_tax_rate = 0
WHERE default_tax_rate IS NULL
  OR default_tax_rate < 0
  OR default_tax_rate > 100;

ALTER TABLE companies
  ALTER COLUMN default_tax_rate SET DEFAULT 0,
  ALTER COLUMN default_tax_rate SET NOT NULL;

ALTER TABLE companies
  DROP CONSTRAINT IF EXISTS companies_default_tax_rate_range;

ALTER TABLE companies
  ADD CONSTRAINT companies_default_tax_rate_range
  CHECK (default_tax_rate >= 0 AND default_tax_rate <= 100);

COMMENT ON COLUMN companies.default_tax_rate IS
  'Default quote sales tax percentage, stored as a percent value such as 8.6 for 8.6%.';
