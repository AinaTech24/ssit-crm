-- Network FP "3.2 MF Suitability Matrix" + "3.3 MF Selection" parity.
--
-- TWO things:
--   1. suitability_matrix_entries — the 3×3 (risk × horizon) grid
--      mapping client profile to recommended coarse categories. Drives
--      proposal generation: when an RM picks a client whose risk profile
--      is 'moderate' + horizon is 'long', the proposal flow can lift
--      this row's coarse_categories as the starting allocation.
--
--   2. scheme_master.evaluation jsonb — the 11-criterion IC scorecard
--      from 3.3 MF Selection. Captures the *snapshot* the IC used when
--      shortlisting; if a scheme stops meeting the criteria at a later
--      review, the IC can compare old vs new and de-shortlist with a
--      defensible trail.

-- ── 1. Suitability matrix ────────────────────────────────────────────
-- One row per (tenant, risk_profile, time_horizon). 3 risks × 3
-- horizons = 9 rows per tenant max. Unique constraint enforces that.
CREATE TABLE IF NOT EXISTS suitability_matrix_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  /** Client risk profile. We use 3 buckets to match the template;
   *  the per-investor risk_profile enum has 4 values
   *  (conservative/moderate/aggressive/very_aggressive) — the
   *  application layer maps very_aggressive → high. */
  risk_profile text NOT NULL,
  /** Client time horizon — same template buckets. */
  time_horizon text NOT NULL,
  /** Recommended coarse categories for this (risk × horizon) cell.
   *  Example: ['equity','hybrid'] for moderate × long.
   *  Values must match scheme_master.coarse_category vocabulary. */
  coarse_categories jsonb DEFAULT '[]'::jsonb,
  /** Optional allocation hints per category — { equity: 60, hybrid: 40 }
   *  for portfolio construction. */
  allocation_hints jsonb,
  /** IC's free-text rationale for this cell. */
  notes text,
  /** Audit. */
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS suitability_matrix_unique
  ON suitability_matrix_entries (tenant_id, risk_profile, time_horizon);

ALTER TABLE suitability_matrix_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON suitability_matrix_entries;
CREATE POLICY tenant_isolation ON suitability_matrix_entries
  USING (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.system_tx', true) = '1'
  )
  WITH CHECK (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.system_tx', true) = '1'
  );

-- ── 2. Scheme evaluation criteria (11 from Network FP 3.3) ───────────
ALTER TABLE scheme_master
  /** IC's snapshot scorecard at the time of shortlisting.
   *  Structure (all fields optional):
   *    {
   *      fundCategoryNote: string,        // "SEBI-defined Large Cap"
   *      fundObjective: string,
   *      schemeRiskProfile: 'low'|'moderate'|'high'|'very_high',
   *      fmName: string,
   *      fmExperienceYears: number,       // > 5 ideal
   *      amcReputationNote: string,
   *      fiveYearCagrPct: number,         // > 12% ideal
   *      consistencyPct: number,          // 0-100 — % of rolling periods beating benchmark
   *      sharpeRatio: number,             // > 1 ideal
   *      stdDevPct: number,               // lower better
   *      expenseRatioPct: number,         // < 2% ideal
   *      portfolioCompositionNote: string,
   *      aumCrore: number,                // > 5000 Cr typical
   *      liquidityNote: string,
   *      verdict: 'pass'|'watch'|'reject',
   *      evaluatedAt: ISO string,
   *      evaluatedBy: uuid
   *    }
   */
  ADD COLUMN IF NOT EXISTS evaluation jsonb;
