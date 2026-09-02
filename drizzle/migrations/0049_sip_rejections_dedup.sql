-- 0049 — SIP rejections: import idempotency key
--
-- The RTA sip_rejection_report ingestion inserts into sip_rejections without a
-- transaction_id (so the existing tx-based unique index doesn't apply) and with
-- no ON CONFLICT — so re-importing a re-exported file (different checksum, same
-- data) duplicates the rejection. dedup_key is a deterministic hash of the
-- rejection's natural key; a unique index on (tenant_id, dedup_key) makes the
-- report path idempotent. Existing rows keep NULL (NULLs are distinct).

ALTER TABLE sip_rejections
  ADD COLUMN IF NOT EXISTS dedup_key text;

CREATE UNIQUE INDEX IF NOT EXISTS sip_rej_dedup_unique
  ON sip_rejections (tenant_id, dedup_key);
