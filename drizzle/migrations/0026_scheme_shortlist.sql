-- AMC Scheme Shortlist — Network FP "3.1 AMC Schemes" parity.
-- The firm's internal investment-committee buy list: which AMCs we
-- recommend, why (philosophy + strengths + red flags), and which
-- specific schemes from each AMC are on the shortlist.

-- ── 1. Per-AMC due-diligence notes on the empanelment record ─────────
ALTER TABLE amc_empanelments
  /** "Core investment philosophy" from the template — how does this
   *  AMC manage money? (e.g. "GARP equity, top-down macro, conservative
   *  credit"). Drives RM-side conviction when proposing portfolios. */
  ADD COLUMN IF NOT EXISTS investment_philosophy text,
  /** Fund-house strengths the firm has identified. */
  ADD COLUMN IF NOT EXISTS fund_house_strengths text,
  /** Red flags / concerns — turnover issues, key-man risk, regulatory
   *  scrutiny, AUM concentration, etc. */
  ADD COLUMN IF NOT EXISTS red_flags text;

-- ── 2. Shortlist flag + rationale on scheme_master ──────────────────
ALTER TABLE scheme_master
  /** True = on the firm's recommended buy list. Distinct from
   *  is_active (which means "available in our catalog"). */
  ADD COLUMN IF NOT EXISTS is_shortlisted boolean DEFAULT false,
  /** When the IC added it. */
  ADD COLUMN IF NOT EXISTS shortlisted_at timestamptz,
  /** Who approved. */
  ADD COLUMN IF NOT EXISTS shortlisted_by uuid REFERENCES users(id),
  /** Why we recommend it — investment-committee rationale. */
  ADD COLUMN IF NOT EXISTS shortlist_rationale text,
  /** Coarse category for the shortlist grouping UI (equity / hybrid /
   *  debt / liquid / commodity / international / other). The existing
   *  `category` column is fine-grained ("Equity - Large Cap"); this one
   *  is the bucket the template uses. */
  ADD COLUMN IF NOT EXISTS coarse_category text;

-- Partial index — only the shortlisted rows; massively cheaper than
-- indexing the whole catalog. Used by the shortlist report's join.
CREATE INDEX IF NOT EXISTS scheme_master_shortlist_idx
  ON scheme_master (tenant_id, amc_code, coarse_category)
  WHERE is_shortlisted = true;
