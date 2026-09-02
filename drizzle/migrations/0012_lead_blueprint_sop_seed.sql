-- Re-seed the new 30-stage SOP blueprint against the existing definition.
-- Reads tenant_id + blueprint_id from the existing row.

DO $$
DECLARE
  bp_id UUID;
  t_id UUID;
BEGIN
  SELECT id, tenant_id INTO bp_id, t_id
  FROM blueprint_definitions
  WHERE module_name = 'leads'
  LIMIT 1;

  IF bp_id IS NULL THEN
    RAISE NOTICE 'No definition row exists — nothing to seed against';
    RETURN;
  END IF;

  -- Insert the 30 stages
  INSERT INTO blueprint_stages (tenant_id, blueprint_id, stage_key, stage_name, description, stage_order, owner_role, required_fields, sla_days, allowed_actions, automations_on_enter, automations_on_exit) VALUES
    (t_id, bp_id, 'new', 'New Lead Created', 'Lead just landed in the system. RM should make first contact.', 1, 'sales', '["name","phone","source","ownerId"]'::jsonb, 1, '["call_done","call_back_later","call_not_connected","contact_in_future"]'::jsonb, '["lead_welcome"]'::jsonb, NULL),
    (t_id, bp_id, 'call_done', 'Call Done', 'First call completed. RM has spoken to the lead.', 2, 'sales', '["lastContactAt"]'::jsonb, 2, '["schedule_meeting","meeting_already_done","mark_not_qualified"]'::jsonb, NULL, NULL),
    (t_id, bp_id, 'call_back_later', 'Call Back Later', 'Lead asked to call back at a specific time.', 3, 'sales', '[]'::jsonb, 2, '["call_done","call_not_connected","contact_in_future"]'::jsonb, NULL, NULL),
    (t_id, bp_id, 'call_not_connected', 'Call Not Connected', 'No answer / number busy. Retry tomorrow.', 4, 'sales', '[]'::jsonb, 1, '["call_done","call_back_later","contact_in_future"]'::jsonb, NULL, NULL),
    (t_id, bp_id, 'contact_in_future', 'Contact in Future', 'Long-term nurture. Auto-resurface in 30/60/90 days.', 5, 'sales', '[]'::jsonb, 30, '["call_done","mark_not_qualified"]'::jsonb, NULL, NULL),
    (t_id, bp_id, 'meeting_scheduled', 'Meeting Scheduled', 'Appointment booked. Reminder fires the day before.', 6, 'sales', '[]'::jsonb, 3, '["meeting_done","reschedule_meeting","meeting_pending"]'::jsonb, NULL, NULL),
    (t_id, bp_id, 'meeting_pending', 'Meeting Pending', 'Meeting booked but client hasn''t confirmed.', 7, 'sales', '[]'::jsonb, 1, '["meeting_done","reschedule_meeting","cancel_meeting"]'::jsonb, NULL, NULL),
    (t_id, bp_id, 'meeting_done', 'Meeting Done', 'Meeting held. Capture outcome and decide next step.', 8, 'sales', '[]'::jsonb, 1, '["mark_won_lead","mark_not_qualified"]'::jsonb, NULL, NULL),
    (t_id, bp_id, 'won_lead', 'Won Lead', 'Qualified lead. Ready to convert into a client.', 9, 'sales', '[]'::jsonb, 2, '["convert_to_client","request_documents"]'::jsonb, '["won_lead_celebration"]'::jsonb, NULL),
    (t_id, bp_id, 'not_qualified', 'Not Qualified', 'Lead is not a fit. Closed-lost.', 10, 'sales', '[]'::jsonb, NULL, '["reopen_lead"]'::jsonb, NULL, NULL),
    (t_id, bp_id, 'request_documents', 'Request Documents', 'KYC + onboarding docs requested from the client.', 11, 'back_office', '[]'::jsonb, 1, '["docs_received","docs_pending"]'::jsonb, '["send_doc_checklist"]'::jsonb, NULL),
    (t_id, bp_id, 'documents_pending', 'Documents Pending', 'Reminders going out. Waiting on client uploads.', 12, 'back_office', '[]'::jsonb, 7, '["docs_received","resend_doc_checklist"]'::jsonb, NULL, NULL),
    (t_id, bp_id, 'documents_received', 'Documents Received', 'All KYC docs in. Run KYC workflow next.', 13, 'back_office', '[]'::jsonb, 1, '["kyc_validated","kyc_registered","kyc_pending"]'::jsonb, NULL, NULL),
    (t_id, bp_id, 'kyc_validated', 'KYC Validated', 'KRA returned validated. Move to UCC creation.', 14, 'compliance', '[]'::jsonb, 1, '["ucc_create"]'::jsonb, NULL, NULL),
    (t_id, bp_id, 'kyc_registered', 'KYC Registered', 'Fresh KYC registered with KRA. Awaiting validation.', 15, 'compliance', '[]'::jsonb, 3, '["kyc_validated","modify_kyc"]'::jsonb, NULL, NULL),
    (t_id, bp_id, 'kyc_pending', 'KYC Pending', 'Client picks Physical or Online KYC route.', 16, 'compliance', '[]'::jsonb, 2, '["physical_kyc","online_kyc"]'::jsonb, NULL, NULL),
    (t_id, bp_id, 'modify_kyc', 'Modify KYC', 'Data correction in flight (address / bank / nominee).', 17, 'compliance', '[]'::jsonb, 3, '["kyc_validated"]'::jsonb, NULL, NULL),
    (t_id, bp_id, 'physical_kyc', 'Physical KYC', 'Offline IPV being scheduled / done.', 18, 'compliance', '[]'::jsonb, 5, '["kyc_validated"]'::jsonb, NULL, NULL),
    (t_id, bp_id, 'online_kyc', 'Online KYC', 'e-KYC via Aadhaar OTP / Digilocker.', 19, 'compliance', '[]'::jsonb, 1, '["kyc_validated"]'::jsonb, NULL, NULL),
    (t_id, bp_id, 'ucc_create', 'UCC Create', 'BSE/NSE Unique Client Code creation in progress.', 20, 'back_office', '[]'::jsonb, 2, '["ucc_activated"]'::jsonb, NULL, NULL),
    (t_id, bp_id, 'ucc_activated', 'UCC Activated', 'Exchange UCC live. Set up SIP mandate next.', 21, 'back_office', '[]'::jsonb, 1, '["mandate_create"]'::jsonb, NULL, NULL),
    (t_id, bp_id, 'mandate_create', 'Mandate Create', 'NACH / e-mandate registration submitted.', 22, 'back_office', '[]'::jsonb, 3, '["mandate_activated","mandate_reject"]'::jsonb, NULL, NULL),
    (t_id, bp_id, 'mandate_activated', 'Mandate Activated', 'Bank confirmed. SIP can debit on the scheduled date.', 23, 'back_office', '[]'::jsonb, 1, '["make_transaction"]'::jsonb, NULL, NULL),
    (t_id, bp_id, 'mandate_reject', 'Mandate Rejected', 'Bank rejected. Fix data and retry registration.', 24, 'back_office', '[]'::jsonb, 2, '["mandate_create"]'::jsonb, NULL, NULL),
    (t_id, bp_id, 'make_transaction', 'Make Transaction', 'First investment being placed on BSE Star / NSE NMF.', 25, 'operations', '[]'::jsonb, 1, '["transaction_successful","transaction_failed"]'::jsonb, NULL, NULL),
    (t_id, bp_id, 'transaction_successful', 'Transaction Successful', 'Units allotted. Client is officially active.', 26, 'operations', '[]'::jsonb, 1, '["family_mapping"]'::jsonb, NULL, NULL),
    (t_id, bp_id, 'transaction_failed', 'Transaction Failed', 'Payment / order failure. Re-attempt.', 27, 'operations', '[]'::jsonb, 1, '["make_transaction"]'::jsonb, NULL, NULL),
    (t_id, bp_id, 'family_mapping', 'Family Mapping', 'Link to spouse / parents / children for household view.', 28, 'sales', '[]'::jsonb, 7, '["update_information"]'::jsonb, NULL, NULL),
    (t_id, bp_id, 'update_information', 'Update Information', 'Master record enriched: goals, occupation, income, nominee.', 29, 'sales', '[]'::jsonb, 3, '["add_in_review_sheet"]'::jsonb, NULL, NULL),
    (t_id, bp_id, 'add_in_review_sheet', 'Active Client', 'Onboarding complete. Added to the quarterly review sheet.', 30, 'sales', '[]'::jsonb, NULL, '[]'::jsonb, '["client_review_cadence_init"]'::jsonb, NULL);

  -- Insert all branching transitions
  INSERT INTO blueprint_transitions (tenant_id, blueprint_id, from_stage_key, to_stage_key, transition_name, allowed_roles) VALUES
    (t_id, bp_id, 'new', 'call_done', 'Call Done', '[]'::jsonb),
    (t_id, bp_id, 'new', 'call_back_later', 'Call Back Later', '[]'::jsonb),
    (t_id, bp_id, 'new', 'call_not_connected', 'Call Not Connected', '[]'::jsonb),
    (t_id, bp_id, 'new', 'contact_in_future', 'Contact in Future', '[]'::jsonb),
    (t_id, bp_id, 'call_done', 'meeting_scheduled', 'Schedule Meeting', '[]'::jsonb),
    (t_id, bp_id, 'call_done', 'meeting_pending', 'Meeting Tentative', '[]'::jsonb),
    (t_id, bp_id, 'call_done', 'not_qualified', 'Not Qualified', '[]'::jsonb),
    (t_id, bp_id, 'call_back_later', 'call_done', 'Reached on Retry', '[]'::jsonb),
    (t_id, bp_id, 'call_back_later', 'call_not_connected', 'Still No Answer', '[]'::jsonb),
    (t_id, bp_id, 'call_back_later', 'contact_in_future', 'Defer Long-term', '[]'::jsonb),
    (t_id, bp_id, 'call_not_connected', 'call_done', 'Eventually Reached', '[]'::jsonb),
    (t_id, bp_id, 'call_not_connected', 'call_back_later', 'Retry Tomorrow', '[]'::jsonb),
    (t_id, bp_id, 'call_not_connected', 'contact_in_future', 'Long-term Nurture', '[]'::jsonb),
    (t_id, bp_id, 'contact_in_future', 'call_done', 'Resurfaced / Reached', '[]'::jsonb),
    (t_id, bp_id, 'contact_in_future', 'not_qualified', 'Confirmed Not Interested', '[]'::jsonb),
    (t_id, bp_id, 'meeting_scheduled', 'meeting_done', 'Meeting Completed', '[]'::jsonb),
    (t_id, bp_id, 'meeting_scheduled', 'meeting_pending', 'Awaiting Confirmation', '[]'::jsonb),
    (t_id, bp_id, 'meeting_pending', 'meeting_done', 'Meeting Completed', '[]'::jsonb),
    (t_id, bp_id, 'meeting_pending', 'meeting_scheduled', 'Confirmed / Rescheduled', '[]'::jsonb),
    (t_id, bp_id, 'meeting_done', 'won_lead', 'Qualified — Win', '[]'::jsonb),
    (t_id, bp_id, 'meeting_done', 'not_qualified', 'Not a Fit', '[]'::jsonb),
    (t_id, bp_id, 'not_qualified', 'call_done', 'Reopen Lead', '[]'::jsonb),
    (t_id, bp_id, 'won_lead', 'request_documents', 'Request Documents', '[]'::jsonb),
    (t_id, bp_id, 'request_documents', 'documents_pending', 'Waiting on Client', '[]'::jsonb),
    (t_id, bp_id, 'request_documents', 'documents_received', 'Docs Received', '[]'::jsonb),
    (t_id, bp_id, 'documents_pending', 'documents_received', 'Docs Received', '[]'::jsonb),
    (t_id, bp_id, 'documents_received', 'kyc_validated', 'Existing KYC Validated', '[]'::jsonb),
    (t_id, bp_id, 'documents_received', 'kyc_registered', 'Fresh KYC Registered', '[]'::jsonb),
    (t_id, bp_id, 'documents_received', 'kyc_pending', 'KYC Verification Pending', '[]'::jsonb),
    (t_id, bp_id, 'kyc_registered', 'kyc_validated', 'Validation Complete', '[]'::jsonb),
    (t_id, bp_id, 'kyc_registered', 'modify_kyc', 'Needs Modification', '[]'::jsonb),
    (t_id, bp_id, 'kyc_pending', 'physical_kyc', 'Physical Route', '[]'::jsonb),
    (t_id, bp_id, 'kyc_pending', 'online_kyc', 'Online Route', '[]'::jsonb),
    (t_id, bp_id, 'modify_kyc', 'kyc_validated', 'Modification Done', '[]'::jsonb),
    (t_id, bp_id, 'physical_kyc', 'kyc_validated', 'IPV Complete', '[]'::jsonb),
    (t_id, bp_id, 'online_kyc', 'kyc_validated', 'e-KYC Complete', '[]'::jsonb),
    (t_id, bp_id, 'kyc_validated', 'ucc_create', 'Create UCC', '[]'::jsonb),
    (t_id, bp_id, 'ucc_create', 'ucc_activated', 'UCC Active', '[]'::jsonb),
    (t_id, bp_id, 'ucc_activated', 'mandate_create', 'Register Mandate', '[]'::jsonb),
    (t_id, bp_id, 'mandate_create', 'mandate_activated', 'Mandate Active', '[]'::jsonb),
    (t_id, bp_id, 'mandate_create', 'mandate_reject', 'Bank Rejected', '[]'::jsonb),
    (t_id, bp_id, 'mandate_reject', 'mandate_create', 'Retry Mandate', '[]'::jsonb),
    (t_id, bp_id, 'mandate_activated', 'make_transaction', 'Place First Order', '[]'::jsonb),
    (t_id, bp_id, 'make_transaction', 'transaction_successful', 'Order Successful', '[]'::jsonb),
    (t_id, bp_id, 'make_transaction', 'transaction_failed', 'Order Failed', '[]'::jsonb),
    (t_id, bp_id, 'transaction_failed', 'make_transaction', 'Retry Order', '[]'::jsonb),
    (t_id, bp_id, 'transaction_successful', 'family_mapping', 'Map Family', '[]'::jsonb),
    (t_id, bp_id, 'family_mapping', 'update_information', 'Enrich Master', '[]'::jsonb),
    (t_id, bp_id, 'update_information', 'add_in_review_sheet', 'Add to Review', '[]'::jsonb);

  RAISE NOTICE 'Seeded 30 stages + 49 transitions';
END $$;
