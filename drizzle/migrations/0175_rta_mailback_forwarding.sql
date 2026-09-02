-- 0175 — Direct RTA mailback import via per-tenant email forwarding
--
-- Each MFD forwards their daily CAMS/KFintech mailback email (password-protected
-- ZIP attachment) to a UNIQUE address on our inbound domain. A catch-all mailbox
-- is polled (src/workers/rta-inbox-poller.ts); the attachment is pushed to S3 and
-- run through the SAME rta.import pipeline as a manual upload.
--
--  rta_forward_addresses  — the address ↔ tenant map (modelled on whatsapp_numbers)
--  rta_inbound_quarantine — platform-level dead-letter for mail we can't route
--
-- The per-tenant ZIP passwords (separate CAMS + KFintech) are stored ENCRYPTED in
-- tenant_integrations (provider 'rta_mailback') — no schema change needed there,
-- the provider column is free-text (Drizzle enum is TS-only).

-- ── Address ↔ tenant map ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rta_forward_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  -- The full unique inbound address, e.g. rta-a1b2c3d4e5@in.crm.ssit.com
  address text NOT NULL,
  -- The unguessable local-part token (the part after "rta-"), kept separately so
  -- the domain can change without breaking the mapping.
  token text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  -- Stamped the first time a real mailback lands on this address (proves the
  -- forwarding rule is live end-to-end).
  verified_at timestamptz,
  last_received_at timestamptz,
  -- Auto-captured Gmail/Outlook forwarding confirmation (so the MFD can confirm
  -- the forwarding rule in one click from Settings instead of hunting the code).
  forwarding_confirm_code text,
  forwarding_confirm_url text,
  forwarding_confirm_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One address is globally unique (it's the routing key); one active row per firm.
CREATE UNIQUE INDEX IF NOT EXISTS rta_forward_addr_address_unique
  ON rta_forward_addresses (lower(address));
CREATE UNIQUE INDEX IF NOT EXISTS rta_forward_addr_token_unique
  ON rta_forward_addresses (token);
CREATE UNIQUE INDEX IF NOT EXISTS rta_forward_addr_tenant_active_unique
  ON rta_forward_addresses (tenant_id) WHERE is_active;

ALTER TABLE rta_forward_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE rta_forward_addresses FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON rta_forward_addresses;
CREATE POLICY tenant_isolation ON rta_forward_addresses FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());

-- ── Dead-letter for unroutable inbound mail ─────────────────────────────────
-- Platform-level (NO tenant_id) — these are messages we could NOT attribute to a
-- tenant, so they are never silently dropped. Inspected by platform admins.
CREATE TABLE IF NOT EXISTS rta_inbound_quarantine (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  to_address text,
  from_address text,
  subject text,
  message_id text,
  reason text NOT NULL,
  received_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rta_inbound_quarantine_created_idx
  ON rta_inbound_quarantine (created_at DESC);
