-- Email upgrade (Zoho-parity):
--   1. Threading columns on communications so inbound replies link to the
--      outbound that triggered them and the record shows real conversations.
--   2. email_suppressions — hard-bounced / unsubscribed addresses the send
--      pipeline must skip (deliverability + DPDP/consent).

ALTER TABLE communications ADD COLUMN IF NOT EXISTS message_id      text;
ALTER TABLE communications ADD COLUMN IF NOT EXISTS in_reply_to     text;
ALTER TABLE communications ADD COLUMN IF NOT EXISTS email_references text;
ALTER TABLE communications ADD COLUMN IF NOT EXISTS thread_id       uuid;

CREATE INDEX IF NOT EXISTS comms_thread_idx     ON communications (tenant_id, thread_id, created_at);
CREATE INDEX IF NOT EXISTS comms_message_id_idx ON communications (tenant_id, message_id);

CREATE TABLE IF NOT EXISTS email_suppressions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  email       text NOT NULL,
  reason      text NOT NULL DEFAULT 'bounced',   -- bounced | complained | unsubscribed | manual
  source      text,                              -- webhook | manual | import
  created_by_id uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS email_suppressions_tenant_email_unique
  ON email_suppressions (tenant_id, lower(email));

ALTER TABLE email_suppressions ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_suppressions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON email_suppressions;
CREATE POLICY tenant_isolation ON email_suppressions
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
