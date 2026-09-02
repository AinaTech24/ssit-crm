-- 0048 — Transactions: import idempotency key
--
-- The Excel import never wrote order_id and had no ON CONFLICT, so re-importing
-- the same file inserted every row again — doubling AUM/inflows/redemptions in
-- every aggregation. (The existing unique (tenant_id, order_id) index was dead
-- because order_id was never set.)
--
-- dedup_key is the import's idempotency key: the real order_id when the sheet
-- provides one, otherwise a deterministic hash of the natural transaction key
-- (investor + scheme + date + type + amount + units). A unique index on
-- (tenant_id, dedup_key) makes a repeat import a no-op via ON CONFLICT DO
-- NOTHING. Existing rows keep dedup_key = NULL (NULLs are distinct, so they
-- never collide).

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS dedup_key text;

CREATE UNIQUE INDEX IF NOT EXISTS tx_tenant_dedup_unique
  ON transactions (tenant_id, dedup_key);
