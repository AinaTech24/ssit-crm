-- 0118 — Manual overrides for the New-SIP installment watch.
--
-- The first-6-installments watch is auto-filled from the CAMS/KFintech feed
-- (transactions of type 'sip' → processed = deducted, rejected = bounced). This
-- table stores the RM's MANUAL marks for SIPs/installments the feed hasn't
-- covered yet (or to correct it). One row per (sip, installment_no); a row here
-- overrides the auto-derived status for that cell.

CREATE TABLE IF NOT EXISTS sip_installment_marks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  sip_id         uuid NOT NULL REFERENCES sips(id) ON DELETE CASCADE,
  installment_no integer NOT NULL,                 -- 1..6
  status         text NOT NULL,                    -- 'deducted' | 'bounced' | 'pending'
  note           text,
  marked_by_id   uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS sip_installment_marks_uq
  ON sip_installment_marks (tenant_id, sip_id, installment_no);
CREATE INDEX IF NOT EXISTS sip_installment_marks_sip_idx
  ON sip_installment_marks (tenant_id, sip_id);

ALTER TABLE sip_installment_marks ENABLE ROW LEVEL SECURITY;
ALTER TABLE sip_installment_marks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sip_installment_marks;
CREATE POLICY tenant_isolation ON sip_installment_marks FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());
