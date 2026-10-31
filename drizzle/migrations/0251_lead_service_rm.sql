-- A second RM on the lead: the one who SERVICES it.
--
-- `owner_id` stays the lead's owner ("Assign RM"): whose book it sits in and
-- whom scoping and reporting use. `service_rm_id` mirrors the client field
-- (investors.service_rm_id, migration 0209) so a firm can name who handles the
-- day-to-day follow-up separately, and it is carried onto the client at
-- conversion. Nullable, nothing back-filled.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS service_rm_id uuid REFERENCES users(id);

CREATE INDEX IF NOT EXISTS leads_service_rm_idx
  ON leads (tenant_id, service_rm_id) WHERE service_rm_id IS NOT NULL;

COMMENT ON COLUMN leads.service_rm_id IS
  'RM who services this lead day-to-day. Distinct from owner_id, the lead owner.';
