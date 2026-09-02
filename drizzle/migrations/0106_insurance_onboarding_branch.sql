-- 0106_insurance_onboarding_branch.sql
--
-- Adds the INSURANCE onboarding branch to the Lead → Client blueprint.
--
-- New tenants get these stages/transitions automatically via the engine seeder
-- (ensureActiveBlueprint reads the constants in src/lib/blueprints/lead_to_client.ts).
-- EXISTING tenants already have their blueprint seeded, and the seeder is a
-- one-time op — so this migration backfills the new stages + transitions into
-- every existing tenant's "leads" blueprint. Idempotent via ON CONFLICT.
--
-- Branch: Won Lead → Needs Analysis → Quote → Proposal → Underwriting →
--         Policy Issued (success) / Not Proceeded (lost).

-- ── Stages (orders 31-36) ────────────────────────────────────────────────
INSERT INTO blueprint_stages
  (tenant_id, blueprint_id, stage_key, stage_name, description, stage_order,
   owner_role, required_fields, sla_days, allowed_actions, automations_on_enter, automations_on_exit)
SELECT d.tenant_id, d.id, s.stage_key, s.stage_name, s.description, s.stage_order,
       s.owner_role, '[]'::jsonb, s.sla_days, s.allowed_actions::jsonb, '[]'::jsonb, '[]'::jsonb
FROM blueprint_definitions d
CROSS JOIN (
  VALUES
    ('insurance_needs_analysis', 'Needs Analysis',
       'Assess the client''s protection gap, dependents, liabilities and goals.',
       31, 'sales', '["insurance_quote"]', 2),
    ('insurance_quote', 'Quote Shared',
       'Illustrations / premium quotes shared for the recommended cover.',
       32, 'sales', '["insurance_proposal","insurance_lost"]', 3),
    ('insurance_proposal', 'Proposal Filled',
       'Proposal form completed; KYC + medicals collected.',
       33, 'operations', '["insurance_underwriting"]', 2),
    ('insurance_underwriting', 'Underwriting',
       'Submitted to the insurer; underwriting / medicals in progress.',
       34, 'operations', '["insurance_policy_issued","insurance_lost"]', 10),
    ('insurance_policy_issued', 'Policy Issued',
       'Policy issued and in force — client onboarded on insurance.',
       35, 'operations', '[]', NULL),
    ('insurance_lost', 'Not Proceeded',
       'Client did not proceed / proposal declined.',
       36, 'sales', '["insurance_needs_analysis"]', NULL)
) AS s(stage_key, stage_name, description, stage_order, owner_role, allowed_actions, sla_days)
WHERE d.module_name = 'leads'
ON CONFLICT (blueprint_id, stage_key) DO NOTHING;

-- ── Transitions ──────────────────────────────────────────────────────────
INSERT INTO blueprint_transitions
  (tenant_id, blueprint_id, from_stage_key, to_stage_key, transition_name, allowed_roles)
SELECT d.tenant_id, d.id, t.from_key, t.to_key, t.name, '[]'::jsonb
FROM blueprint_definitions d
CROSS JOIN (
  VALUES
    ('won_lead', 'insurance_needs_analysis', 'Start Insurance Onboarding'),
    ('insurance_needs_analysis', 'insurance_quote', 'Share Quote'),
    ('insurance_quote', 'insurance_proposal', 'Proposal Filled'),
    ('insurance_quote', 'insurance_lost', 'Dropped'),
    ('insurance_proposal', 'insurance_underwriting', 'Submit to Insurer'),
    ('insurance_underwriting', 'insurance_policy_issued', 'Policy Issued'),
    ('insurance_underwriting', 'insurance_lost', 'Declined'),
    ('insurance_lost', 'insurance_needs_analysis', 'Reopen')
) AS t(from_key, to_key, name)
WHERE d.module_name = 'leads'
ON CONFLICT (blueprint_id, from_stage_key, to_stage_key) DO NOTHING;
