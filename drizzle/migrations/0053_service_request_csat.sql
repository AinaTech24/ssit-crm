-- 0053 — Service requests: CSAT capture
--
-- Post-resolution client-satisfaction rating (1–5) + optional comment, captured
-- on the ticket once it's resolved/closed. Feeds the satisfaction KPI on the
-- list. Additive on an already-RLS-protected table → no new policy needed.

ALTER TABLE service_requests
  ADD COLUMN IF NOT EXISTS csat_rating integer,
  ADD COLUMN IF NOT EXISTS csat_comment text,
  ADD COLUMN IF NOT EXISTS csat_at timestamptz;
