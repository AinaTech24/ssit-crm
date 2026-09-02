-- 0096 — Approve existing non-marketing templates that were left in draft.
--
-- The comms pipeline only sends a template when templates.status = 'approved'.
-- For TRANSACTIONAL / UTILITY templates the submit flow auto-approves with NO
-- human step (there is no compliance-officer review for non-marketing), so a
-- template sitting in 'draft' carries no pending review — it was simply created
-- (e.g. from an email starter) and never published. Those sends fail with
-- "template_not_approved".
--
-- This backfill publishes those templates: it does EXACTLY what hitting "Submit"
-- would have done for them. Strictly scoped so the compliance moat is preserved:
--   • MARKETING templates are untouched — they still require officer approval.
--   • WhatsApp templates are untouched — they still require Meta approval.
--   • Every send still passes the per-send compliance gate regardless.

-- Publish the current version of each affected template first (while the parent
-- is still draft/pending), then flip the template status.
UPDATE template_versions tv
SET approval_status = 'approved_internal',
    approved_at     = COALESCE(tv.approved_at, now()),
    updated_at      = now()
FROM templates t
WHERE tv.id = t.current_version_id
  AND tv.tenant_id = t.tenant_id
  AND t.status   IN ('draft', 'pending_approval')
  AND t.category IN ('transactional', 'utility')
  AND t.channel  IN ('email', 'sms')
  AND tv.approval_status IN ('draft', 'submitted');

UPDATE templates t
SET status     = 'approved',
    updated_at = now()
WHERE t.status   IN ('draft', 'pending_approval')
  AND t.category IN ('transactional', 'utility')
  AND t.channel  IN ('email', 'sms');
