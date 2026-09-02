-- 0039 — Lead module hardening
-- Adds normalized lead identity fields used by duplicate checks/imports and
-- aligns the legacy leads.stage text vocabulary with the 30-stage blueprint.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS email_normalized text,
  ADD COLUMN IF NOT EXISTS phone_normalized text,
  ADD COLUMN IF NOT EXISTS pan text;

UPDATE leads
   SET email_normalized = NULLIF(lower(trim(email)), '')
 WHERE email IS NOT NULL
   AND email_normalized IS NULL;

UPDATE leads
   SET phone_normalized = NULLIF(right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10), '')
 WHERE phone IS NOT NULL
   AND phone_normalized IS NULL;

UPDATE leads
   SET stage = CASE stage
     WHEN 'contacted' THEN 'call_done'
     WHEN 'first_call_pending' THEN 'call_done'
     WHEN 'follow_up' THEN 'contact_in_future'
     WHEN 'appointment_scheduled' THEN 'meeting_scheduled'
     WHEN 'qualified' THEN 'meeting_scheduled'
     WHEN 'proposal_sent' THEN 'won_lead'
     WHEN 'proposal_shared' THEN 'won_lead'
     WHEN 'proposal_drafted' THEN 'won_lead'
     WHEN 'proposal_approved' THEN 'won_lead'
     WHEN 'risk_profile_sent' THEN 'won_lead'
     WHEN 'risk_profiled' THEN 'won_lead'
     WHEN 'docs_requested' THEN 'request_documents'
     WHEN 'docs_received' THEN 'documents_received'
     WHEN 'converted' THEN CASE
       WHEN converted_investor_id IS NULL THEN 'won_lead'
       ELSE 'converted'
     END
     WHEN 'post_meeting_qualified' THEN 'won_lead'
     WHEN 'lost' THEN 'not_qualified'
     WHEN 'not_interested' THEN 'not_qualified'
     WHEN 'cold' THEN 'not_qualified'
     WHEN 'mandate_rejected' THEN 'mandate_reject'
     ELSE stage
   END,
   updated_at = now()
 WHERE stage IN (
   'contacted', 'first_call_pending', 'follow_up', 'appointment_scheduled',
   'qualified', 'proposal_sent', 'proposal_shared', 'proposal_drafted',
   'proposal_approved', 'risk_profile_sent', 'risk_profiled', 'docs_requested',
   'docs_received', 'converted', 'post_meeting_qualified', 'lost',
   'not_interested', 'cold', 'mandate_rejected'
 );

CREATE INDEX IF NOT EXISTS leads_phone_norm_idx
  ON leads (tenant_id, phone_normalized)
  WHERE phone_normalized IS NOT NULL;

CREATE INDEX IF NOT EXISTS leads_email_norm_idx
  ON leads (tenant_id, email_normalized)
  WHERE email_normalized IS NOT NULL;

CREATE INDEX IF NOT EXISTS leads_pan_idx
  ON leads (tenant_id, pan)
  WHERE pan IS NOT NULL;
