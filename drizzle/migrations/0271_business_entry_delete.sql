-- Delete on a transaction only marked it "Cancelled", and cancelled entries stay in the list, so nothing seemed to
-- happen. A deleted entry now carries deleted_at: gone from the list, its pages and reports, kept for the audit trail.

ALTER TABLE business_entries ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Entries people already tried to delete (the audit trail says which). Entries someone set to Cancelled through
-- "Set status" or the edit form are left as they are. Isolated: if it cannot run, the deploy still goes ahead.
DO $repair$ BEGIN
UPDATE business_entries e
   SET deleted_at = a.at
  FROM (
    SELECT tenant_id, entity_id AS entry_id, at
      FROM audit_log
     WHERE action IN ('business_entry.cancel', 'business_entry.bulk_delete')
    UNION ALL
    SELECT l.tenant_id, x.value::uuid, l.at
      FROM audit_log l,
           jsonb_array_elements_text(CASE WHEN jsonb_typeof(l.after -> 'ids') = 'array' THEN l.after -> 'ids' ELSE '[]'::jsonb END) AS x(value)
     WHERE l.action = 'business_entry.bulk_delete'
  ) a
 WHERE e.id = a.entry_id AND e.tenant_id = a.tenant_id AND e.status = 'cancelled' AND e.deleted_at IS NULL;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'deleted transaction repair skipped: %', SQLERRM;
END $repair$;
