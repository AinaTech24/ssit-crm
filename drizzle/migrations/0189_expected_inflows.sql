-- Expected inflows — money a client has TOLD you is coming (FD maturity, bonus,
-- property sale, LIC maturity, gratuity…) on a known future date.
--
-- Before this, the only way to hold "he gets ₹12L in March" was a free-text task:
-- no amount, no ₹ pipeline, no way to ask "what is maturing next quarter across
-- my whole book?". This table makes future AUM a first-class, reportable thing.
--
-- The reminder itself reuses the existing task engine: creating an inflow spawns
-- a task (due `remind_days_before` ahead) whose id is kept in `reminder_task_id`,
-- so the proven reminder + notification pipeline does the nudging.
CREATE TABLE IF NOT EXISTS expected_inflows (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  investor_id        uuid NOT NULL REFERENCES investors(id) ON DELETE CASCADE,
  /** Who owns the follow-through. Defaults to the client's RM at creation. */
  owner_id           uuid REFERENCES users(id),

  /** fd_maturity | insurance_maturity | bonus | property_sale | gratuity |
   *  esop | inheritance | ppf_epf | rent | business_income | other */
  source_type        text NOT NULL DEFAULT 'other',
  expected_amount    numeric(18,2),
  /** The date the money lands (or the 1st of the month if only a month is known). */
  expected_on        date NOT NULL,
  /** high | medium | low — how sure the client sounded. */
  confidence         text NOT NULL DEFAULT 'medium',

  /** expected | confirmed | invested | partially_invested | lapsed | cancelled */
  status             text NOT NULL DEFAULT 'expected',
  invested_amount    numeric(18,2),
  invested_at        date,

  /** Nudge this many days before `expected_on`. */
  remind_days_before integer NOT NULL DEFAULT 14,
  reminder_task_id   uuid,
  notes              text,

  created_by         uuid REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS expected_inflows_due_idx
  ON expected_inflows (tenant_id, expected_on, status);
CREATE INDEX IF NOT EXISTS expected_inflows_investor_idx
  ON expected_inflows (tenant_id, investor_id);
CREATE INDEX IF NOT EXISTS expected_inflows_owner_idx
  ON expected_inflows (tenant_id, owner_id, expected_on);

ALTER TABLE expected_inflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE expected_inflows FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON expected_inflows;
CREATE POLICY tenant_isolation ON expected_inflows FOR ALL
  USING (tenant_id = app_tenant_id() OR app_is_platform_admin())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin());
