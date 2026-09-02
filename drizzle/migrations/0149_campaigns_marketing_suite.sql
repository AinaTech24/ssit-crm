-- Marketing Campaigns module — feature suite:
--   A/B testing      : a second template variant + split %, winner marker, and a
--                       per-message `variant` tag on communications.
--   Click tracking   : per-message clicked_at on communications (aggregated into
--                       campaigns.clicked_count by the dispatcher reconcile).
--   Recurrence       : a campaign can recur (daily/weekly/monthly); the dispatcher
--                       clones a fresh scheduled run when one completes.
--   Frequency cap    : per-tenant ceiling on marketing messages per rolling window
--                       (anti-fatigue / WhatsApp-ban protection) — enforced in the
--                       comms pipeline.

-- ── Campaigns: A/B + recurrence + lineage ────────────────────────────────────
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS variant_template_id uuid;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS variant_template_version_id uuid;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS ab_split_pct integer DEFAULT 50;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS ab_winner text;          -- 'a' | 'b' | null
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS recurrence text DEFAULT 'none';  -- none | daily | weekly | monthly
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS recurrence_until timestamptz;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS parent_campaign_id uuid;  -- set on clones spawned by recurrence

-- ── Communications: A/B variant tag + click tracking ─────────────────────────
ALTER TABLE communications ADD COLUMN IF NOT EXISTS variant text;        -- 'a' | 'b' | null (campaign sends)
ALTER TABLE communications ADD COLUMN IF NOT EXISTS clicked_at timestamptz;

CREATE INDEX IF NOT EXISTS comms_campaign_idx
  ON communications (tenant_id, campaign_id, status)
  WHERE campaign_id IS NOT NULL;

-- ── Tenants: marketing frequency cap (anti-fatigue) ──────────────────────────
-- NULL cap = disabled. When set, the comms pipeline skips a marketing send to a
-- subject who already received `cap` marketing messages within the trailing
-- `window_days` days. Defaults are conservative-but-generous so existing tenants
-- are protected without surprising throttling (6 marketing msgs / 7 days).
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS marketing_freq_cap integer DEFAULT 6;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS marketing_freq_window_days integer DEFAULT 7;
