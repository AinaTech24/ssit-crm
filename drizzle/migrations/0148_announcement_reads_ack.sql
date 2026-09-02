-- 0148 — Announcement read receipts + required acknowledgement.
--   · requires_ack on announcements: staff must click "I acknowledge".
--   · announcement_reads: per-user read/ack tracking (powers the unread strip
--     + the manager "X of Y acknowledged" view).

ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS requires_ack boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS announcement_reads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  announcement_id uuid NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  read_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS announcement_reads_unique
  ON announcement_reads (announcement_id, user_id);
CREATE INDEX IF NOT EXISTS announcement_reads_user_idx
  ON announcement_reads (tenant_id, user_id);

ALTER TABLE announcement_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcement_reads FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON announcement_reads FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());
