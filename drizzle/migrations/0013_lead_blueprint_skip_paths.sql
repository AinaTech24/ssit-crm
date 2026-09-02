-- ============================================================================
-- 0013 — Add the "skip" transitions to the client-phase SOP
--
-- Per the reference SOP diagram:
--   - Won Lead → Documents Received  (skip Request when already received)
--   - KYC Validated → UCC Activated  (skip Create when already active)
--   - UCC Activated → Mandate Activated  (skip Create when already active)
--   - UCC Activated → Mandate Reject  (record upfront rejection)
--
-- Idempotent — uses NOT EXISTS so re-running is safe.
-- ============================================================================

DO $$
DECLARE
  bp_id UUID;
  t_id  UUID;
BEGIN
  SELECT id, tenant_id INTO bp_id, t_id
  FROM blueprint_definitions
  WHERE module_name = 'leads' LIMIT 1;
  IF bp_id IS NULL THEN
    RAISE NOTICE 'No leads blueprint found — nothing to update';
    RETURN;
  END IF;

  -- Won Lead → Documents Received
  IF NOT EXISTS (
    SELECT 1 FROM blueprint_transitions
    WHERE blueprint_id = bp_id AND from_stage_key = 'won_lead' AND to_stage_key = 'documents_received'
  ) THEN
    INSERT INTO blueprint_transitions (tenant_id, blueprint_id, from_stage_key, to_stage_key, transition_name, allowed_roles)
    VALUES (t_id, bp_id, 'won_lead', 'documents_received', 'Documents Already Received', '[]'::jsonb);
  END IF;

  -- KYC Validated → UCC Activated (skip Create)
  IF NOT EXISTS (
    SELECT 1 FROM blueprint_transitions
    WHERE blueprint_id = bp_id AND from_stage_key = 'kyc_validated' AND to_stage_key = 'ucc_activated'
  ) THEN
    INSERT INTO blueprint_transitions (tenant_id, blueprint_id, from_stage_key, to_stage_key, transition_name, allowed_roles)
    VALUES (t_id, bp_id, 'kyc_validated', 'ucc_activated', 'UCC Already Active', '[]'::jsonb);
  END IF;

  -- UCC Activated → Mandate Activated (skip Create)
  IF NOT EXISTS (
    SELECT 1 FROM blueprint_transitions
    WHERE blueprint_id = bp_id AND from_stage_key = 'ucc_activated' AND to_stage_key = 'mandate_activated'
  ) THEN
    INSERT INTO blueprint_transitions (tenant_id, blueprint_id, from_stage_key, to_stage_key, transition_name, allowed_roles)
    VALUES (t_id, bp_id, 'ucc_activated', 'mandate_activated', 'Mandate Already Active', '[]'::jsonb);
  END IF;

  -- UCC Activated → Mandate Reject (upfront rejection)
  IF NOT EXISTS (
    SELECT 1 FROM blueprint_transitions
    WHERE blueprint_id = bp_id AND from_stage_key = 'ucc_activated' AND to_stage_key = 'mandate_reject'
  ) THEN
    INSERT INTO blueprint_transitions (tenant_id, blueprint_id, from_stage_key, to_stage_key, transition_name, allowed_roles)
    VALUES (t_id, bp_id, 'ucc_activated', 'mandate_reject', 'Record Bank Rejection', '[]'::jsonb);
  END IF;

  RAISE NOTICE 'Skip-path transitions added.';
END $$;
