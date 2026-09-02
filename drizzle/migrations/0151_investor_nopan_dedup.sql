-- 0151 — Import PAN-less RTA folios without fabricating PANs.
--
-- CAMS R9 / KFintech MFSD feeds sometimes carry folios whose holder has a BLANK
-- PAN (PAN-exempt micro-folios, or PAN not yet updated with the registrar). We
-- still want to import them (don't lose the client + AUM), but the client master
-- keys on PAN — so they were skipped.
--
-- Fix: import them with pan = NULL (never a fabricated PAN) and dedupe on a
-- deterministic natural key (mobile / email / name) stored here, so re-importing
-- the same file updates in place instead of creating duplicates.

ALTER TABLE investors ADD COLUMN IF NOT EXISTS rta_nopan_key text;

CREATE UNIQUE INDEX IF NOT EXISTS investors_tenant_nopan_key_uq
  ON investors (tenant_id, rta_nopan_key)
  WHERE rta_nopan_key IS NOT NULL;
