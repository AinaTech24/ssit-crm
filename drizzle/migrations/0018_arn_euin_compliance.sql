-- ARN / EUIN / NISM / DSC compliance tracker (Network FP template parity).
--
-- Adds the per-employee licensing fields MFDs need to track for SEBI /
-- AMFI audit. Existing fields already in users:
--   - euin                 (EUIN number)
--   - nism_cert_no         (NISM certificate number)
--   - nism_expiry_at       (NISM expiry)
--   - nism_category        (V-A / V-B etc)
--
-- Missing (closing now):
--   - employee_code        (HR-side ID, distinct from system UUID)
--   - distributing_amcs    (which AMCs this employee is authorised for)
--   - nism_exam_date       (when they passed; renewal interval calc)
--   - personal_arn         (per-employee ARN; some firms register
--                            individual ARNs for senior RMs / sub-brokers)
--   - arn_registration_date / arn_expiry_at  (ARN renewal cadence is
--                                             3 years; track explicitly)
--   - euin_expiry_at       (EUIN is tied to NISM but track separately
--                            so we can flag the cliff)
--   - dsc_submitted        (Digital Signature Certificate filed?)
--   - dsc_last_submitted_at / dsc_expiry_at  (DSC validity is typically
--                                             1-2 years; renewal driver)

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS employee_code text,
  ADD COLUMN IF NOT EXISTS distributing_amcs jsonb,
  ADD COLUMN IF NOT EXISTS nism_exam_date date,
  ADD COLUMN IF NOT EXISTS personal_arn text,
  ADD COLUMN IF NOT EXISTS arn_registration_date date,
  ADD COLUMN IF NOT EXISTS arn_expiry_at date,
  ADD COLUMN IF NOT EXISTS euin_expiry_at date,
  ADD COLUMN IF NOT EXISTS dsc_submitted boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS dsc_last_submitted_at date,
  ADD COLUMN IF NOT EXISTS dsc_expiry_at date;

-- Help the compliance tracker report — frequent "expiring in next 60d"
-- filters need an index on each expiry column scoped to the tenant.
-- A single composite per tenant keeps the index small for ~30 employees
-- per tenant (the realistic ceiling for a MFD firm). Where clauses use
-- coalesce of the four expiries to find the earliest, so an index per
-- column would over-fit; a single tenant-id index is good enough.

CREATE INDEX IF NOT EXISTS users_tenant_compliance_idx
  ON users (tenant_id, status)
  WHERE status IN ('active', 'offboarding');

-- Optional uniqueness for employee_code within a tenant. We don't
-- enforce it as NOT NULL (legacy rows + users created via signup don't
-- have HR codes) but if two rows do have the same code in the same
-- tenant, that's a data error worth flagging.
CREATE UNIQUE INDEX IF NOT EXISTS users_tenant_employee_code_unique
  ON users (tenant_id, employee_code)
  WHERE employee_code IS NOT NULL;
