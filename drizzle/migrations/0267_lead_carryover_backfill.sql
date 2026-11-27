-- Bring across what earlier lead conversions left behind.
--
-- Conversion ran all its carry-over steps inside one savepoint (one failing step undid the rest) and never moved
-- the lead's logged activities, tasks or notes. This repairs clients that were converted before the fix. Every
-- statement only touches rows still pointing at a converted lead, so running it twice changes nothing.
--
-- Each statement is isolated: a repair that cannot be applied is reported as a notice and skipped, so it can
-- never stop a deploy or undo the other repairs.

DO $repair$ BEGIN
UPDATE compliance_documents d
   SET related_entity_type = 'investor', related_entity_id = l.converted_investor_id, updated_at = now()
  FROM leads l
  JOIN investors i ON i.id = l.converted_investor_id
 WHERE d.tenant_id = l.tenant_id AND d.related_entity_type = 'lead' AND d.related_entity_id = l.id;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'lead carry-over repair 1 skipped: %', SQLERRM;
END $repair$;

DO $repair$ BEGIN
UPDATE activities a
   SET subject_type = 'investor', subject_id = l.converted_investor_id, updated_at = now()
  FROM leads l
  JOIN investors i ON i.id = l.converted_investor_id
 WHERE a.tenant_id = l.tenant_id AND a.subject_type = 'lead' AND a.subject_id = l.id;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'lead carry-over repair 2 skipped: %', SQLERRM;
END $repair$;

DO $repair$ BEGIN
UPDATE tasks t
   SET related_investor_id = l.converted_investor_id, updated_at = now()
  FROM leads l
  JOIN investors i ON i.id = l.converted_investor_id
 WHERE t.tenant_id = l.tenant_id AND t.related_investor_id IS NULL
   AND (t.related_lead_id = l.id OR (t.subject_type = 'lead' AND t.subject_id = l.id));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'lead carry-over repair 3 skipped: %', SQLERRM;
END $repair$;

DO $repair$ BEGIN
UPDATE review_meetings m
   SET investor_id = l.converted_investor_id, lead_id = NULL, updated_at = now()
  FROM leads l
  JOIN investors i ON i.id = l.converted_investor_id
 WHERE m.tenant_id = l.tenant_id AND m.lead_id = l.id AND m.investor_id IS NULL;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'lead carry-over repair 4 skipped: %', SQLERRM;
END $repair$;

DO $repair$ BEGIN
UPDATE proposals p
   SET investor_id = l.converted_investor_id, recipient_type = 'investor', updated_at = now()
  FROM leads l
  JOIN investors i ON i.id = l.converted_investor_id
 WHERE p.tenant_id = l.tenant_id AND p.lead_id = l.id AND p.investor_id IS NULL;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'lead carry-over repair 5 skipped: %', SQLERRM;
END $repair$;

DO $repair$ BEGIN
UPDATE communications c
   SET investor_id = l.converted_investor_id, updated_at = now()
  FROM leads l
  JOIN investors i ON i.id = l.converted_investor_id
 WHERE c.tenant_id = l.tenant_id AND c.lead_id = l.id AND c.investor_id IS NULL;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'lead carry-over repair 6 skipped: %', SQLERRM;
END $repair$;

-- The lead's own notes boxes as one note on the client (only when that note is not there yet).
DO $repair$ BEGIN
INSERT INTO activities (id, tenant_id, branch_id, subject_type, subject_id, subject_name, subject_phone, kind, subject, notes, occurred_at, owner_user_id)
SELECT gen_random_uuid(), l.tenant_id, i.branch_id, 'investor', i.id, l.name, l.phone, 'note', 'Notes from the lead stage',
       left(concat_ws(E'\n\n',
              CASE WHEN NULLIF(btrim(COALESCE(l.follow_up_notes, '')), '') IS NOT NULL THEN E'Follow-up notes:\n' || btrim(l.follow_up_notes) END,
              CASE WHEN NULLIF(btrim(COALESCE(l.notes, '')), '') IS NOT NULL THEN E'Internal notes:\n' || btrim(l.notes) END), 20000),
       COALESCE(l.converted_at, now()), l.owner_id
  FROM leads l
  JOIN investors i ON i.id = l.converted_investor_id
 WHERE (NULLIF(btrim(COALESCE(l.follow_up_notes, '')), '') IS NOT NULL OR NULLIF(btrim(COALESCE(l.notes, '')), '') IS NOT NULL)
   AND NOT EXISTS (
         SELECT 1 FROM activities x
          WHERE x.tenant_id = l.tenant_id AND x.subject_type = 'investor' AND x.subject_id = i.id
            AND x.subject = 'Notes from the lead stage');
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'lead carry-over repair 7 skipped: %', SQLERRM;
END $repair$;
