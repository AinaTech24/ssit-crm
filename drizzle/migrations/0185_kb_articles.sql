-- Public Knowledge Base articles (the "KAIZEN" series and any future series).
-- Marketing/education content on the PUBLIC site, authored by SSIT admins — so it is a
-- platform-level table (no tenant_id, therefore no RLS, same as landing_packages).
--
-- Gating model: `scenario_md` + `questions` are PUBLIC (crawlable, shown to
-- everyone). `solution_md` + `screenshots` are GATED — served only to a visitor
-- with a valid session, which is what drives signups.
CREATE TABLE IF NOT EXISTS kb_articles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  /** Series name, e.g. 'KAIZEN'. Lets us run more series later. */
  series          text NOT NULL DEFAULT 'KAIZEN',
  /** Episode number within the series (KAIZEN #1, #2 …). */
  episode_no      integer,
  slug            text NOT NULL,
  title           text NOT NULL,
  /** One-line teaser shown on the hub card. */
  hook            text,

  -- ── PUBLIC (ungated) ──
  scenario_md     text NOT NULL DEFAULT '',
  questions       jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- ── GATED (requires login) ──
  solution_md     text NOT NULL DEFAULT '',
  /** [{ storageKey, caption, alt }] — streamed via /api/kb/image/[id] to sessions only. */
  screenshots     jsonb NOT NULL DEFAULT '[]'::jsonb,

  /** CRM modules this scenario touches — rendered as tags. */
  modules         jsonb NOT NULL DEFAULT '[]'::jsonb,
  read_minutes    integer,
  /** Optional PUBLIC cover image (storage key) for the hub card + social preview. */
  cover_key       text,

  seo_title       text,
  seo_description text,

  published       boolean NOT NULL DEFAULT false,
  published_at    timestamptz,
  sort_order      integer NOT NULL DEFAULT 0,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS kb_articles_slug_unique ON kb_articles (lower(slug));
CREATE INDEX IF NOT EXISTS kb_articles_pub_idx ON kb_articles (published, series, episode_no);
