-- A second RM on the client: the one who SERVICES them.
--
-- `rm_id` is the relationship owner — whose book the client sits in, who is
-- credited, who the dashboards scope by. In practice a different person often
-- handles day-to-day servicing (statements, mandates, the phone call about a
-- failed SIP), and firms were overloading rm_id or tracking it in a note.
--
-- Kept as its own column rather than reusing rm_id so ownership reporting does
-- not change meaning: every existing query that reads rm_id keeps working, and
-- nothing is back-filled.

ALTER TABLE investors
  ADD COLUMN IF NOT EXISTS service_rm_id uuid REFERENCES users(id);

CREATE INDEX IF NOT EXISTS investors_service_rm_idx
  ON investors (tenant_id, service_rm_id) WHERE service_rm_id IS NOT NULL;

COMMENT ON COLUMN investors.service_rm_id IS
  'RM who services this client day-to-day. Distinct from rm_id, the relationship owner.';
