-- 0097 — Add the "Schedule Follow-up Meeting" transition (meeting_done →
-- meeting_scheduled) to every already-seeded Lead → Client blueprint.
--
-- Blueprint stages/transitions are seeded once per tenant on first use, so a new
-- transition added to the code catalog won't appear for existing tenants without
-- a backfill. MFD sales typically take 2-3 meetings; this lets an RM book a
-- follow-up from "Meeting Done" instead of being forced into won/lost.

INSERT INTO blueprint_transitions
  (id, tenant_id, blueprint_id, from_stage_key, to_stage_key, transition_name, allowed_roles, created_at, updated_at)
SELECT gen_random_uuid(), bd.tenant_id, bd.id, 'meeting_done', 'meeting_scheduled',
       'Schedule Follow-up Meeting', '[]'::jsonb, now(), now()
FROM blueprint_definitions bd
WHERE bd.module_name = 'leads'
ON CONFLICT (blueprint_id, from_stage_key, to_stage_key) DO NOTHING;
