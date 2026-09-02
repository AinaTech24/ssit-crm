-- 0051 — Insurance: category-specific details (JSONB)
--
-- The insurance create form is now type-aware: selecting a policy type
-- (life / health / motor / general) reveals category-specific fields, and the
-- new AI policy-document auto-fill lands extracted values here. Rather than add
-- a sparse column per attribute (motor IDV/NCB, health co-pay/room-rent,
-- business type, proposer-when-different), we hold them in one JSONB blob so a
-- new category never needs a migration.

ALTER TABLE insurance_policies
  ADD COLUMN IF NOT EXISTS details jsonb NOT NULL DEFAULT '{}'::jsonb;
