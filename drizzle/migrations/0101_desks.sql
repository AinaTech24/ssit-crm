-- 0101 — Desks (Branch → Desk → RM sub-branch layer).
--
-- A desk is a sub-branch reporting unit (e.g. "DK", "RC", "1" under Anand). Each
-- desk groups several RMs; users.desk_id assigns a user to a desk. The monthly
-- MIS rolls up desk → branch → firm.

CREATE TABLE IF NOT EXISTS desks (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  branch_id  uuid NOT NULL REFERENCES branches(id),
  name       text NOT NULL,
  code       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS desks_tenant_branch_idx ON desks (tenant_id, branch_id);
CREATE UNIQUE INDEX IF NOT EXISTS desks_branch_name_unique ON desks (tenant_id, branch_id, name);

ALTER TABLE desks ENABLE ROW LEVEL SECURITY;
ALTER TABLE desks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON desks;
CREATE POLICY tenant_isolation ON desks FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());

-- Assign each user to a desk (nullable; FK enforced here).
ALTER TABLE users ADD COLUMN IF NOT EXISTS desk_id uuid REFERENCES desks(id);
CREATE INDEX IF NOT EXISTS users_desk_idx ON users (tenant_id, desk_id);
