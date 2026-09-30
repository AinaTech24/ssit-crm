-- Meetings and notes against an AMC empanelment.
--
-- An empanelment row is a STATUS: codes, contacts, dates, whether the firm is
-- still on the panel. It says nothing about the relationship — the quarterly
-- review that happened, the commission the RM promised to check, the product
-- manager who is leaving. That lived in people's inboxes, so it left the firm
-- when they did.
--
-- Two tables rather than one with a `kind` discriminator: a meeting has a date,
-- attendees and a follow-up that a note does not, and folding them together
-- leaves half the columns null on every row.
--
-- Both cascade with the empanelment — deleting the panel entry should not
-- strand its history as orphan rows nothing can reach.

CREATE TABLE IF NOT EXISTS amc_meetings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id),
  amc_empanelment_id  uuid NOT NULL REFERENCES amc_empanelments(id) ON DELETE CASCADE,
  meeting_date        date NOT NULL,
  subject             text NOT NULL,
  attendees           text,
  notes               text,
  follow_up           text,
  created_by_user_id  uuid REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS amc_meetings_amc_idx
  ON amc_meetings (tenant_id, amc_empanelment_id, meeting_date);

CREATE TABLE IF NOT EXISTS amc_notes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id),
  amc_empanelment_id  uuid NOT NULL REFERENCES amc_empanelments(id) ON DELETE CASCADE,
  note                text NOT NULL,
  noted_on            date,
  created_by_user_id  uuid REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS amc_notes_amc_idx
  ON amc_notes (tenant_id, amc_empanelment_id, created_at);

-- Tenant isolation — the canonical policy every tenant-scoped table gets
-- (see 0030_rls_backfill_all_tenant_tables.sql). npm run check:rls fails the
-- build without it.
ALTER TABLE amc_meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE amc_meetings FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON amc_meetings;
CREATE POLICY tenant_isolation ON amc_meetings FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());

ALTER TABLE amc_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE amc_notes FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON amc_notes;
CREATE POLICY tenant_isolation ON amc_notes FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());
