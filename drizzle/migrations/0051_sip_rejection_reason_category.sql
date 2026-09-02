-- 0051 — SIP rejections: reason_category + escalated_at
--
-- reason_category buckets a free-text rejection reason into the same slugs the
-- automation recipe branches on (insufficient_balance / mandate_expired /
-- technical / other). It is now populated on EVERY insert path — the RTA
-- rejection-report import, the reconciliation scanner (transaction-feed bounces)
-- and the manual create form — so the recovery pipeline can show a reason-mix
-- breakdown and filter by category. That cut is the most actionable one for an
-- MFD: a mandate problem needs a fresh NACH registration; a low-balance problem
-- needs a client nudge; a technical reject auto-retries.
--
-- escalated_at stamps when the 2-day-SLA escalation last fired for a rejection,
-- so the daily escalation pass notifies the owner / branch-head + RM exactly
-- once instead of re-pinging every day the item stays overdue.
--
-- Both columns are additive on an already-RLS-protected table, so no new policy
-- is required (the tenant_isolation policy already covers every column).

ALTER TABLE sip_rejections
  ADD COLUMN IF NOT EXISTS reason_category text,
  ADD COLUMN IF NOT EXISTS escalated_at timestamptz;

CREATE INDEX IF NOT EXISTS sip_rej_reason_cat_idx
  ON sip_rejections (tenant_id, reason_category);

-- Backfill reason_category for rows already in the tracker so the new breakdown
-- and filter are meaningful on day one. Mirrors classifyRejectionReason().
UPDATE sip_rejections
SET reason_category = CASE
  WHEN lower(coalesce(rejection_reason, '')) ~ 'insufficient|balance|funds|nsf|inqufd' THEN 'insufficient_balance'
  WHEN lower(coalesce(rejection_reason, '')) ~ 'mandate|expired|umrn|nach|debit not|not registered' THEN 'mandate_expired'
  ELSE 'technical'
END
WHERE reason_category IS NULL;
