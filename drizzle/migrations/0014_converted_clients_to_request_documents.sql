-- Migration 0014: Push existing converted clients into the client phase.
--
-- After the 30-stage SOP rewrite, the convert flow leaves the shared
-- blueprint instance at whatever lead-phase stage the user was on when
-- they hit "Convert" (typically won_lead, but in practice often as
-- early as call_done because users skip ahead). This makes converted
-- clients invisible in the Clients Kanban: lead-phase stages aren't
-- rendered as columns, so cards fall back to the "Active Client"
-- terminal column and refuse to advance forward.
--
-- Backfill: any lead with converted_investor_id IS NOT NULL whose
-- blueprint is still at a lead-phase stage (order 1-10) gets pushed
-- to "request_documents" — the natural entry point of the client phase.
-- A stage_history row records the migration for the audit trail.
--
-- Going forward, /api/leads/[id]/convert calls autoAdvance() with
-- event="client.converted" so new conversions land at request_documents
-- automatically and this backfill is only needed once.

BEGIN;

-- Close any open history row at the old (lead-phase) stage.
UPDATE lead_stage_history h
   SET exited_at = now(),
       remarks = COALESCE(h.remarks, '') || ' [backfill: pushed forward to request_documents on convert]'
  FROM lead_blueprint_instances lbi
  INNER JOIN leads l ON l.id = lbi.lead_id
  INNER JOIN blueprint_stages s
    ON s.blueprint_id = lbi.blueprint_id AND s.stage_key = lbi.current_stage_key
 WHERE h.instance_id = lbi.id
   AND h.exited_at IS NULL
   AND l.converted_investor_id IS NOT NULL
   AND s.stage_order <= 10;

-- Open a new history row at request_documents.
INSERT INTO lead_stage_history (tenant_id, lead_id, instance_id, stage_key, entered_at, remarks)
SELECT lbi.tenant_id, lbi.lead_id, lbi.id, 'request_documents', now(),
       'Backfill — lead was already converted; entering client onboarding phase.'
  FROM lead_blueprint_instances lbi
  INNER JOIN leads l ON l.id = lbi.lead_id
  INNER JOIN blueprint_stages s
    ON s.blueprint_id = lbi.blueprint_id AND s.stage_key = lbi.current_stage_key
 WHERE l.converted_investor_id IS NOT NULL
   AND s.stage_order <= 10;

-- Advance the instance pointer.
UPDATE lead_blueprint_instances lbi
   SET current_stage_key = 'request_documents',
       stage_entered_at = now(),
       is_delayed = false,
       delayed_since = NULL,
       updated_at = now()
  FROM leads l, blueprint_stages s
 WHERE l.id = lbi.lead_id
   AND s.blueprint_id = lbi.blueprint_id
   AND s.stage_key = lbi.current_stage_key
   AND l.converted_investor_id IS NOT NULL
   AND s.stage_order <= 10;

-- Mirror back to the legacy leads.stage column so list filters stay in sync.
UPDATE leads
   SET stage = 'request_documents',
       stage_changed_at = now(),
       updated_at = now()
 WHERE converted_investor_id IS NOT NULL
   AND stage IN ('new','call_done','call_back_later','call_not_connected',
                 'contact_in_future','meeting_scheduled','meeting_pending',
                 'meeting_done','won_lead','not_qualified');

COMMIT;
