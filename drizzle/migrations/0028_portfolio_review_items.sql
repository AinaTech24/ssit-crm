-- Portfolio Review Items — Network FP "3.4 Portfolio Review" parity.
--
-- Per-folio review snapshot captured during a specific review meeting.
-- One row per (meeting × folio) — the RM's working document during the
-- meeting, with qualitative notes per holding and a recommended action.
--
-- Why snapshot, not live: a review meeting takes place on a specific
-- date. NAVs / values change daily. We freeze the numbers at review
-- time so when the IC audits "what did you recommend back in March?",
-- the reviewer sees the same numbers the client saw.

CREATE TABLE IF NOT EXISTS portfolio_review_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  /** The review meeting this item belongs to. */
  meeting_id uuid NOT NULL REFERENCES review_meetings(id) ON DELETE CASCADE,
  /** The folio being reviewed. */
  folio_id uuid NOT NULL REFERENCES folios(id),
  /** Convenience — denormalised so the review row survives even if the
   *  folio is later archived. */
  scheme_name text,
  fund_category text,
  investment_type text, -- 'sip' | 'lumpsum' | 'mixed'

  /** Snapshot at review time — don't trust live values when reading
   *  historical reviews. */
  snapshot_current_value numeric(18, 2),
  snapshot_invested_amount numeric(18, 2),
  snapshot_units numeric(18, 6),
  /** Start date of investment — earliest transaction. */
  start_date date,
  /** Computed at snapshot time: months from start_date to meeting_date. */
  holding_period_months integer,
  /** XIRR or absolute % return as of the snapshot. */
  return_pct numeric(8, 4),

  /** Qualitative notes — the RM fills in during the meeting. */
  exit_load_note text,
  tax_implication_note text,
  past_performance_note text,
  suitability_note text,

  /** Recommended action — drives downstream automation hooks. */
  recommended_action text DEFAULT 'hold',
  -- values: hold / switch / exit / increase / decrease / pause_sip /
  --         resume_sip / new_sip / step_up / step_down / no_action

  /** When action = 'switch', the target scheme. */
  target_scheme_id uuid REFERENCES scheme_master(id),
  /** When action = increase / new_sip / step_up — by how much (₹). */
  action_amount numeric(18, 2),

  /** Free text for context the structured fields don't capture. */
  rationale text,
  remarks text,

  /** Stamped when the recommended action is actually executed
   *  (e.g. switch placed, SIP paused). NULL = open / pending. */
  action_taken_at timestamptz,
  action_taken_by uuid REFERENCES users(id),

  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One review entry per (meeting, folio).
CREATE UNIQUE INDEX IF NOT EXISTS portfolio_review_items_unique
  ON portfolio_review_items (meeting_id, folio_id);

CREATE INDEX IF NOT EXISTS portfolio_review_items_tenant_meeting_idx
  ON portfolio_review_items (tenant_id, meeting_id);

CREATE INDEX IF NOT EXISTS portfolio_review_items_pending_action_idx
  ON portfolio_review_items (tenant_id, recommended_action)
  WHERE action_taken_at IS NULL
    AND recommended_action <> 'hold'
    AND recommended_action <> 'no_action';

ALTER TABLE portfolio_review_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON portfolio_review_items;
CREATE POLICY tenant_isolation ON portfolio_review_items
  USING (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.system_tx', true) = '1'
  )
  WITH CHECK (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.system_tx', true) = '1'
  );
