-- Webhook idempotency ledger.
--
-- Payment/webhook providers (Razorpay, …) deliver AT-LEAST-ONCE: a delivery that
-- doesn't get a 2xx in time is retried, and the same event can arrive more than
-- once. Without dedup, a redelivered `payment.failed` double-increments the
-- dunning counter and a redelivered `subscription.charged` writes a duplicate
-- payment row into the subscription_events audit (inflating any revenue tally).
--
-- This table records each (provider, event_id) once. The webhook handler inserts
-- the id inside the SAME transaction as its processing (ON CONFLICT DO NOTHING):
-- a duplicate insert returns no row → the handler skips and acks; a processing
-- failure rolls back the insert too, so a genuine retry re-processes.
--
-- Platform-infra table (no tenant_id) — webhooks run in system context, like
-- scheme_nav, so it has NO RLS and is correctly ignored by the RLS CI check.

CREATE TABLE IF NOT EXISTS webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  event_id text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS webhook_events_provider_event_unique
  ON webhook_events (provider, event_id);
