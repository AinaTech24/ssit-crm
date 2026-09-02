-- KYC tracker — Network FP "2.4 Client Database / KYC Tracker" parity.
-- Adds the SEBI-side validation status fields MFDs need to track
-- separately from the simple operational kyc_status.

-- ── 1. Extend investors with 6 missing fields ────────────────────────
ALTER TABLE investors
  /** Distinct from `name` (display). Some clients display a short name
   *  but PAN is the legal full name — keep them separate. */
  ADD COLUMN IF NOT EXISTS name_as_per_pan text,
  /** PAN-Aadhaar link status — SEBI now requires the firm to confirm
   *  this is "Linked" for every new investment. */
  ADD COLUMN IF NOT EXISTS pan_aadhaar_link_status text,
  /** Granular residency — beyond the binary `investor_category='nri'`. */
  ADD COLUMN IF NOT EXISTS residency_status text,
  /** When CERSAI validation completed (distinct from ckyc_expiry_at). */
  ADD COLUMN IF NOT EXISTS kyc_validated_at date,
  /** User who last updated KYC fields — audit-friendly source. */
  ADD COLUMN IF NOT EXISTS kyc_last_updated_by uuid REFERENCES users(id),
  /** Aadhaar last 4 digits only — NEVER store full Aadhaar. */
  ADD COLUMN IF NOT EXISTS aadhaar_last4 char(4);

-- Index for the new KYC tracker report — filter by kyc_status + link status.
CREATE INDEX IF NOT EXISTS investors_kyc_tracker_idx
  ON investors (tenant_id, kyc_status, pan_aadhaar_link_status);

-- ── 2. Extend kyc_status enum with 'registered' + 'hold' ─────────────
-- Postgres text-enum columns don't have a true enum type when we
-- declared via text + check; we use the Drizzle pattern of just adding
-- values. No DDL change needed at DB level for text columns, but the
-- application schema (and any Zod) needs to know the new values. To
-- match the Drizzle enum we explicitly extend by allowing the column to
-- accept the new strings — no migration step at DB level for text
-- columns. (Comment kept for reviewers wondering why no ALTER here.)
