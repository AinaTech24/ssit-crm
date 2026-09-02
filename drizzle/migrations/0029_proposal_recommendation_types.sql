-- Proposal recommendation types — Network FP "3.6 Product
-- Recommendation" parity.
--
-- Existing proposal_schemes covered SIP + Lumpsum amounts but couldn't
-- distinguish the four recommendation modes the template uses, and
-- had no SWP/STP-specific fields. Extends in place — no breaking
-- changes; older rows default to recommendation_type='sip' or
-- 'lumpsum' inferred at read time.

ALTER TABLE proposal_schemes
  /** Which of the 4 NFP recommendation types this row is. */
  ADD COLUMN IF NOT EXISTS recommendation_type text DEFAULT 'sip',
  --   values: sip / lumpsum / swp / stp

  /** Regular vs Direct plan — template "Type" column. */
  ADD COLUMN IF NOT EXISTS plan_type text,
  --   values: regular / direct

  /** Annual step-up % on the SIP. Null = flat SIP. */
  ADD COLUMN IF NOT EXISTS step_up_pct numeric(5, 2),

  /** Free text — which life goal does this scheme cover? */
  ADD COLUMN IF NOT EXISTS goal_or_objective text,

  -- ── SWP fields ─────────────────────────────────────────────────────
  ADD COLUMN IF NOT EXISTS corpus_required numeric(18, 2),
  ADD COLUMN IF NOT EXISTS monthly_withdrawal numeric(18, 2),
  ADD COLUMN IF NOT EXISTS swp_period_months integer,

  -- ── STP fields ─────────────────────────────────────────────────────
  /** STP transfers FROM scheme_name TO this scheme. */
  ADD COLUMN IF NOT EXISTS to_scheme_name text,
  ADD COLUMN IF NOT EXISTS to_scheme_code text,
  ADD COLUMN IF NOT EXISTS monthly_transfer numeric(18, 2),
  ADD COLUMN IF NOT EXISTS num_installments integer,
  /** Total corpus needed up-front to fund the STP. */
  ADD COLUMN IF NOT EXISTS total_corpus_for_stp numeric(18, 2);

-- Index by recommendation_type so the "show me all SWP rows in
-- proposals last quarter" report is fast.
CREATE INDEX IF NOT EXISTS proposal_schemes_recommendation_idx
  ON proposal_schemes (tenant_id, recommendation_type);
