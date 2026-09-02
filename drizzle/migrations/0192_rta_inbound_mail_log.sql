-- 0192 — Inbound RTA mail log (the "did my forward actually arrive?" view)
--
-- Before this, a forwarded mailback that ROUTED successfully left behind only a
-- `last_received_at` timestamp on rta_forward_addresses — no sender, no subject,
-- no attachment list. And a mail that FAILED to route went to
-- rta_inbound_quarantine, which had no UI at all. Both made "is forwarding
-- working?" a question you could only answer by SSH-ing to the box and grepping
-- worker logs.
--
-- This table logs EVERY message the poller touches — routed or not — with the
-- per-attachment classification verdict, so SSIT Admin can answer that question
-- on one screen.
--
-- Supersedes rta_inbound_quarantine (rows are migrated in below; the old table is
-- left in place, unread, rather than dropped — it costs nothing and keeps this
-- migration reversible).

CREATE TABLE IF NOT EXISTS rta_inbound_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Resolved firm. NULL = we could NOT attribute this mail to any tenant
  -- (bad/rotated address, or someone mailed the catch-all directly).
  tenant_id uuid,
  forward_address_id uuid,

  -- Envelope
  message_id text,
  from_address text,
  from_name text,
  -- The recipient we matched on (or the first one we saw, when unroutable).
  to_address text,
  recipients jsonb NOT NULL DEFAULT '[]'::jsonb,
  subject text,
  -- First ~2000 chars of the plain-text body. Enough to identify the mail and
  -- read a forwarding-confirmation code; deliberately NOT the full body.
  body_snippet text,
  received_at timestamptz,

  -- What we did with it.
  --   imported       — at least one attachment queued for import
  --   duplicate      — recognised, but every attachment was already in flight
  --   confirmation   — Gmail/Outlook forwarding-confirmation mail (no data)
  --   no_attachment  — routed to a firm, but nothing importable recognised
  --   unroutable     — no forwarding address matched
  --   error          — handler blew up
  outcome text NOT NULL,
  reason text,

  attachment_count integer NOT NULL DEFAULT 0,
  queued_count integer NOT NULL DEFAULT 0,
  duplicate_count integer NOT NULL DEFAULT 0,
  -- Per-attachment verdicts:
  -- [{ filename, size, source, kind, outcome, importId, reason }]
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,

  created_at timestamptz NOT NULL DEFAULT now()
);

-- Message-ID is globally unique per RFC 5322, so re-processing the same message
-- (poller crashed before marking \Seen) refreshes the row instead of duplicating.
CREATE UNIQUE INDEX IF NOT EXISTS rta_inbound_msg_message_id_unique
  ON rta_inbound_messages (message_id) WHERE message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS rta_inbound_msg_created_idx
  ON rta_inbound_messages (created_at DESC);
CREATE INDEX IF NOT EXISTS rta_inbound_msg_tenant_idx
  ON rta_inbound_messages (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS rta_inbound_msg_outcome_idx
  ON rta_inbound_messages (outcome, created_at DESC);

-- RLS: the table carries tenant_id, so `npm run check:rls` requires ENABLE +
-- FORCE + a tenant_isolation policy. Unroutable rows (tenant_id IS NULL) are
-- visible to platform admins only — which is exactly right, since by definition
-- we don't know whose mail they are.
ALTER TABLE rta_inbound_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE rta_inbound_messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON rta_inbound_messages;
CREATE POLICY tenant_isolation ON rta_inbound_messages FOR ALL
  USING (app_is_platform_admin() OR tenant_id = app_tenant_id())
  WITH CHECK (app_is_platform_admin() OR tenant_id = app_tenant_id());

-- Carry the existing dead-letter rows across so no history is lost.
-- Guarded: rta_inbound_quarantine only exists where 0175 ran, and a freshly
-- built or partially-migrated database must not fail on this backfill.
DO $$
BEGIN
  IF to_regclass('public.rta_inbound_quarantine') IS NOT NULL THEN
    INSERT INTO rta_inbound_messages (
      to_address, from_address, subject, message_id, outcome, reason, received_at, created_at
    )
    SELECT q.to_address, q.from_address, q.subject, q.message_id,
           'unroutable', q.reason, q.received_at, q.created_at
    FROM rta_inbound_quarantine q
    WHERE NOT EXISTS (
      SELECT 1 FROM rta_inbound_messages m
      WHERE m.message_id IS NOT NULL AND m.message_id = q.message_id
    )
    -- Two quarantine rows can share a message_id (same mail seen twice) — the
    -- partial unique index would reject the batch, so absorb it.
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
