-- ============================================================================
-- 0011 — Lead → Client blueprint redesigned as a full SOP (30 stages,
-- branching graph).
--
-- This migration:
--   1. Maps existing leads.stage values onto the new vocabulary.
--   2. Wipes the per-tenant `blueprint_stages` + `blueprint_transitions`
--      rows so the engine's `ensureActiveBlueprint()` re-seeds them from
--      the new LEAD_TO_CLIENT_STAGES catalog on the next request.
--   3. Re-points existing `lead_blueprint_instances.current_stage_key`
--      and `lead_stage_history.stage_key` to the new keys via the same
--      mapping.
--
-- Safe to re-run: all operations are idempotent (mapping a key that's
-- already the new value is a no-op).
-- ============================================================================

-- 1) Update leads.stage to the new vocabulary
UPDATE leads SET stage = CASE stage
  WHEN 'contacted'                  THEN 'call_done'
  WHEN 'first_call_pending'         THEN 'call_done'
  WHEN 'qualified'                  THEN 'meeting_scheduled'
  WHEN 'appointment_scheduled'      THEN 'meeting_scheduled'
  WHEN 'post_meeting_qualified'     THEN 'meeting_done'
  WHEN 'risk_profile_sent'          THEN 'meeting_done'      -- collapsed; goal-track now post-conversion
  WHEN 'risk_profiled'              THEN 'meeting_done'
  WHEN 'proposal_drafted'           THEN 'won_lead'
  WHEN 'proposal_shared'            THEN 'won_lead'
  WHEN 'proposal_sent'              THEN 'won_lead'
  WHEN 'proposal_approved'          THEN 'won_lead'
  WHEN 'docs_requested'             THEN 'won_lead'          -- now post-conversion: request_documents
  WHEN 'docs_received'              THEN 'won_lead'
  WHEN 'follow_up'                  THEN 'call_back_later'
  WHEN 'lost'                       THEN 'not_qualified'
  WHEN 'not_interested'             THEN 'not_qualified'
  WHEN 'cold'                       THEN 'contact_in_future'
  ELSE stage
END
WHERE stage IN (
  'contacted','first_call_pending','qualified','appointment_scheduled',
  'post_meeting_qualified','risk_profile_sent','risk_profiled',
  'proposal_drafted','proposal_shared','proposal_sent','proposal_approved',
  'docs_requested','docs_received','follow_up','lost','not_interested','cold'
);

-- 2) Repoint blueprint instances + history onto the new keys
UPDATE lead_blueprint_instances SET current_stage_key = CASE current_stage_key
  WHEN 'first_call_pending'         THEN 'call_done'
  WHEN 'appointment_scheduled'      THEN 'meeting_scheduled'
  WHEN 'post_meeting_qualified'     THEN 'meeting_done'
  WHEN 'risk_profile_sent'          THEN 'meeting_done'
  WHEN 'risk_profiled'              THEN 'meeting_done'
  WHEN 'proposal_drafted'           THEN 'won_lead'
  WHEN 'proposal_sent'              THEN 'won_lead'
  WHEN 'proposal_approved'          THEN 'won_lead'
  WHEN 'docs_requested'             THEN 'won_lead'
  WHEN 'docs_received'              THEN 'won_lead'
  WHEN 'ops_in_progress'            THEN 'request_documents'
  WHEN 'portal_welcome_sent'        THEN 'transaction_successful'
  WHEN 'active_client'              THEN 'add_in_review_sheet'
  ELSE current_stage_key
END;

UPDATE lead_stage_history SET stage_key = CASE stage_key
  WHEN 'first_call_pending'         THEN 'call_done'
  WHEN 'appointment_scheduled'      THEN 'meeting_scheduled'
  WHEN 'post_meeting_qualified'     THEN 'meeting_done'
  WHEN 'risk_profile_sent'          THEN 'meeting_done'
  WHEN 'risk_profiled'              THEN 'meeting_done'
  WHEN 'proposal_drafted'           THEN 'won_lead'
  WHEN 'proposal_sent'              THEN 'won_lead'
  WHEN 'proposal_approved'          THEN 'won_lead'
  WHEN 'docs_requested'             THEN 'won_lead'
  WHEN 'docs_received'              THEN 'won_lead'
  WHEN 'ops_in_progress'            THEN 'request_documents'
  WHEN 'portal_welcome_sent'        THEN 'transaction_successful'
  WHEN 'active_client'              THEN 'add_in_review_sheet'
  ELSE stage_key
END;

-- 3) Drop existing blueprint stage + transition definitions so the
--    engine re-seeds from the new catalog on the next call to
--    ensureActiveBlueprint().
DELETE FROM blueprint_transitions
  WHERE blueprint_id IN (SELECT id FROM blueprint_definitions WHERE module_name = 'lead_to_client');
DELETE FROM blueprint_stages
  WHERE blueprint_id IN (SELECT id FROM blueprint_definitions WHERE module_name = 'lead_to_client');
DELETE FROM blueprint_definitions WHERE module_name = 'lead_to_client';
