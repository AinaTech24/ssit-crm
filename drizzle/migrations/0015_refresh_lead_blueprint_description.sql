-- Migration 0015: refresh the Lead → Client blueprint description.
--
-- Tenants seeded before the 30-stage SOP redesign carry the old
-- "15 stages" description in their blueprint_definitions row. The
-- engine has since seeded each tenant with 30 stages, but the parent
-- row's description column was never updated — so the Blueprints list
-- card reads "15 stages from new lead through active client" while
-- the actual graph holds 30 stages with branching.
--
-- Update any existing row whose description still references the old
-- "15 stages" copy. Idempotent.

BEGIN;

UPDATE blueprint_definitions
   SET description = 'Full Lead → Client SOP — 30 stages with branching paths (call-back loops, KYC routes, mandate/transaction retries).',
       blueprint_name = 'Lead → Client SOP',
       updated_at = now()
 WHERE module_name = 'leads'
   AND (description LIKE '%15 stages%'
        OR blueprint_name = 'Lead → Client journey');

COMMIT;
