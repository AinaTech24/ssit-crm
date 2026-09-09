-- Activity tracker — a work log for the roles whose output is not a client
-- record: Marketing (posts, flyers, videos) and RIA/Research (what was
-- researched, on what topic).
--
-- ONE table with a `kind` discriminator rather than two, because the shape is
-- the same in both cases — who asked, who it is for, what was produced, when it
-- was assigned, when it was finished, and files. Only a couple of columns are
-- kind-specific, and two tables would mean two APIs, two attachment tables and
-- two sets of RLS policies for what is one idea.
--
-- Distinct from `tasks`: a task is an instruction with a status workflow. This
-- is the record of what was actually produced, which is what these roles are
-- reviewed on and what tasks alone cannot tell you.

CREATE TABLE IF NOT EXISTS activity_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),

  -- 'marketing' | 'research'. Drives which fields the form shows.
  kind text NOT NULL DEFAULT 'marketing',

  -- Who did the work. Defaults to the creator; an owner can log on behalf.
  owner_user_id uuid REFERENCES users(id),
  -- The RM who asked for it. Nullable: self-initiated work is normal.
  assigned_by_user_id uuid REFERENCES users(id),
  -- Free text on purpose — "for" is a client, a branch, a campaign or a person
  -- who is none of those, and forcing an FK here would push people to leave it
  -- blank rather than say what it was really for.
  created_for text,

  title text NOT NULL,
  -- marketing: post | flyer | video | brochure | other
  -- research:  note | report | model | screener | other
  item_type text,
  event_name text,
  -- research only: the subject studied.
  topic text,
  notes text,

  assigned_date date,
  completed_date date,
  status text NOT NULL DEFAULT 'in_progress',

  -- Optional link to the task this came from, so the two views agree.
  task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,

  created_by_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activity_entries_kind_idx
  ON activity_entries (tenant_id, kind, assigned_date DESC);
CREATE INDEX IF NOT EXISTS activity_entries_owner_idx
  ON activity_entries (tenant_id, owner_user_id, assigned_date DESC);
CREATE INDEX IF NOT EXISTS activity_entries_assigner_idx
  ON activity_entries (tenant_id, assigned_by_user_id);

ALTER TABLE activity_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_entries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON activity_entries;
CREATE POLICY tenant_isolation ON activity_entries
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Files produced: the flyer itself, the research PDF. Same shape as
-- task_attachments so the shared EntityAttachments component works unchanged.
CREATE TABLE IF NOT EXISTS activity_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  activity_id uuid NOT NULL REFERENCES activity_entries(id) ON DELETE CASCADE,
  uploaded_by uuid REFERENCES users(id),
  file_name text NOT NULL,
  content_type text,
  size_bytes bigint,
  storage_key text NOT NULL,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activity_attachments_activity_idx
  ON activity_attachments (tenant_id, activity_id, created_at);

ALTER TABLE activity_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_attachments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON activity_attachments;
CREATE POLICY tenant_isolation ON activity_attachments
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

COMMENT ON TABLE activity_entries IS
  'Work log for Marketing (items produced) and RIA/Research (topics studied).';
COMMENT ON COLUMN activity_entries.kind IS 'marketing | research — drives the form fields.';
