-- Induction module — team-member training tracks, progress, exam, letter.
--
-- Distinct from the existing `onboarding` tables, which are CLIENT onboarding
-- (investor pipelines). "Employees" in this product is a view over `users`, so
-- everything here keys on users(id).

-- ─────────────────────────── tracks ───────────────────────────
CREATE TABLE IF NOT EXISTS induction_tracks (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  name              text NOT NULL,
  description       text,
  -- roles this track auto-enrols, e.g. ["rm"]
  target_roles      jsonb NOT NULL DEFAULT '[]'::jsonb,
  pass_mark         integer NOT NULL DEFAULT 70,
  max_attempts      integer,                    -- null = unlimited
  cooldown_hours    integer NOT NULL DEFAULT 24,
  issue_letter      boolean NOT NULL DEFAULT true,
  -- opt-in hard gate; default false = nudge only (see design §3)
  block_until_passed boolean NOT NULL DEFAULT false,
  -- annual-refresher support: days after passing that the pass stays valid
  valid_days        integer,
  status            text NOT NULL DEFAULT 'draft',   -- draft | active | archived
  created_by        uuid REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS induction_tracks_tenant_idx ON induction_tracks (tenant_id, status);

-- ─────────────────────────── lessons ───────────────────────────
CREATE TABLE IF NOT EXISTS induction_lessons (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  track_id          uuid NOT NULL REFERENCES induction_tracks(id) ON DELETE CASCADE,
  position          integer NOT NULL,
  title             text NOT NULL,
  summary           text,
  kind              text NOT NULL DEFAULT 'video',  -- video | document | kb_article | link | checklist
  video_key         text,          -- S3 object key (self-hosted)
  video_url         text,          -- external (YouTube / Vimeo)
  duration_seconds  integer,
  doc_key           text,
  kb_article_id     uuid,
  body_md           text,
  -- sidebar hrefs unlocked when this lesson completes (SIDEBAR_REGISTRY keys)
  unlocks_modules   jsonb NOT NULL DEFAULT '[]'::jsonb,
  required          boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS induction_lessons_pos_idx ON induction_lessons (track_id, position);
CREATE INDEX IF NOT EXISTS induction_lessons_tenant_idx ON induction_lessons (tenant_id, track_id);

-- ─────────────────────────── enrolments ───────────────────────────
CREATE TABLE IF NOT EXISTS induction_enrolments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  track_id            uuid NOT NULL REFERENCES induction_tracks(id) ON DELETE CASCADE,
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status              text NOT NULL DEFAULT 'not_started', -- not_started|in_progress|exam_ready|passed|failed
  started_at          timestamptz,
  completed_at        timestamptz,
  valid_until         timestamptz,
  letter_issued_at    timestamptz,
  letter_token        text,
  assigned_by_user_id uuid REFERENCES users(id),
  due_at              timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS induction_enrolments_uniq ON induction_enrolments (track_id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS induction_enrolments_token_idx ON induction_enrolments (letter_token)
  WHERE letter_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS induction_enrolments_tenant_idx ON induction_enrolments (tenant_id, user_id, status);

-- ─────────────────────────── progress ───────────────────────────
CREATE TABLE IF NOT EXISTS induction_progress (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  enrolment_id         uuid NOT NULL REFERENCES induction_enrolments(id) ON DELETE CASCADE,
  lesson_id            uuid NOT NULL REFERENCES induction_lessons(id) ON DELETE CASCADE,
  watched_seconds      integer NOT NULL DEFAULT 0,
  max_position_seconds integer NOT NULL DEFAULT 0,
  completed_at         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS induction_progress_uniq ON induction_progress (enrolment_id, lesson_id);
CREATE INDEX IF NOT EXISTS induction_progress_tenant_idx ON induction_progress (tenant_id, enrolment_id);

-- ─────────────────────────── questions ───────────────────────────
CREATE TABLE IF NOT EXISTS induction_questions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  track_id     uuid NOT NULL REFERENCES induction_tracks(id) ON DELETE CASCADE,
  lesson_id    uuid REFERENCES induction_lessons(id) ON DELETE SET NULL,
  prompt       text NOT NULL,
  options      jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{key,text}]
  correct_keys jsonb NOT NULL DEFAULT '[]'::jsonb,   -- never sent to the client
  explanation  text,
  points       integer NOT NULL DEFAULT 1,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS induction_questions_tenant_idx ON induction_questions (tenant_id, track_id, active);

-- ─────────────────────────── attempts ───────────────────────────
CREATE TABLE IF NOT EXISTS induction_attempts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  enrolment_id uuid NOT NULL REFERENCES induction_enrolments(id) ON DELETE CASCADE,
  attempt_no   integer NOT NULL,
  started_at   timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  -- frozen question set (prompt + options + order) for this attempt
  questions    jsonb NOT NULL DEFAULT '[]'::jsonb,
  answers      jsonb NOT NULL DEFAULT '{}'::jsonb,
  score_pct    numeric(5,2),
  passed       boolean,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS induction_attempts_uniq ON induction_attempts (enrolment_id, attempt_no);
CREATE INDEX IF NOT EXISTS induction_attempts_tenant_idx ON induction_attempts (tenant_id, enrolment_id);

-- ─────────────────────────── RLS ───────────────────────────
ALTER TABLE induction_tracks     ENABLE ROW LEVEL SECURITY;
ALTER TABLE induction_tracks     FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON induction_tracks;
CREATE POLICY tenant_isolation ON induction_tracks FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());

ALTER TABLE induction_lessons    ENABLE ROW LEVEL SECURITY;
ALTER TABLE induction_lessons    FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON induction_lessons;
CREATE POLICY tenant_isolation ON induction_lessons FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());

ALTER TABLE induction_enrolments ENABLE ROW LEVEL SECURITY;
ALTER TABLE induction_enrolments FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON induction_enrolments;
CREATE POLICY tenant_isolation ON induction_enrolments FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());

ALTER TABLE induction_progress   ENABLE ROW LEVEL SECURITY;
ALTER TABLE induction_progress   FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON induction_progress;
CREATE POLICY tenant_isolation ON induction_progress FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());

ALTER TABLE induction_questions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE induction_questions  FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON induction_questions;
CREATE POLICY tenant_isolation ON induction_questions FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());

ALTER TABLE induction_attempts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE induction_attempts   FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON induction_attempts;
CREATE POLICY tenant_isolation ON induction_attempts FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());
