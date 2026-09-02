-- 0178 — Additional UCC codes on investors.
--
-- A client can hold several Unique Client Codes (across BSE Star MF, NSE NMF II,
-- MFU, or multiple registrations). The single bse_ucc_code / nse_can_code columns
-- stay as the primary exchange identifiers (used at order placement); this new
-- list captures any extras and is editable in the master form + importable.
--
-- Additive + idempotent. Same table already has RLS, so no policy change needed.

ALTER TABLE investors ADD COLUMN IF NOT EXISTS ucc_codes jsonb NOT NULL DEFAULT '[]'::jsonb;
