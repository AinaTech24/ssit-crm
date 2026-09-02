-- 0100 — Monthly branch-metric tracker.
--
-- The data behind the firm's monthly-meeting MIS tables (branch-wise "AUM
-- Status", "SIP Book Size", and any future metric of the same shape:
-- Target · this-month · % achievement · last-month · MoM).
--
-- One row per (metric_key × period × source). A source is an internal branch
-- (branch_id set; value pre-filled from the live CRM rollup, then editable to the
-- firm's authoritative figure) or an external platform (branch_id null,
-- source_name set — e.g. "Reliance Securities", "IIFL" — entered manually).
-- value_num is in the metric's display unit (Cr / Lakh / …). target_num is the FY
-- annual target, carried forward month to month. The report computes %
-- achievement + month-on-month.

CREATE TABLE IF NOT EXISTS metric_snapshots (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  metric_key  text NOT NULL,                       -- 'aum' | 'sip_book' | …
  period      text NOT NULL,                       -- 'YYYY-MM' month-end
  source_type text NOT NULL DEFAULT 'branch',      -- branch | external
  branch_id   uuid REFERENCES branches(id),
  source_name text NOT NULL,
  value_num   numeric(20,4) NOT NULL DEFAULT 0,
  target_num  numeric(20,4),
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS metric_snapshots_lookup_idx
  ON metric_snapshots (tenant_id, metric_key, period);

-- One row per branch per metric per month; one per external name per metric/month.
CREATE UNIQUE INDEX IF NOT EXISTS metric_snapshots_branch_unique
  ON metric_snapshots (tenant_id, metric_key, period, branch_id)
  WHERE branch_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS metric_snapshots_external_unique
  ON metric_snapshots (tenant_id, metric_key, period, source_name)
  WHERE branch_id IS NULL;

ALTER TABLE metric_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE metric_snapshots FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON metric_snapshots;
CREATE POLICY tenant_isolation ON metric_snapshots FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());
