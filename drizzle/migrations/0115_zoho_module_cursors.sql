-- Per-(tenant, module) sync cursors for the table-polled Zoho modules
-- (Tasks, Meetings, Risk Profiles, Families, Insurance, Claims, Business
-- Entries, SIPs, SIP Rejections, Schemes). The outbox-driven modules
-- (investor, lead) keep using zoho_sync_state.last_outbox_id; this jsonb maps
-- our entityType -> "<updatedAt ISO>|<row id>".
--
-- zoho_sync_state already exists (0114) with RLS enabled, so this is a plain,
-- idempotent column add — no new policy needed.
ALTER TABLE zoho_sync_state
  ADD COLUMN IF NOT EXISTS module_cursors jsonb NOT NULL DEFAULT '{}'::jsonb;
