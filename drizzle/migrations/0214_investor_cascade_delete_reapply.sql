-- Permanent client deletion is failing again: re-apply the investor cascade.
--
-- 0131_investor_cascade_delete walked the FK graph from `investors` and turned
-- every child FK into ON DELETE CASCADE. It ran (2026-09-02) and worked. But a
-- foreign key only carries the delete rule it was created with, and any later
-- migration that dropped and re-added one — or added a brand-new table
-- referencing investors, which several since have — brings back the default
-- NO ACTION. Twenty of them are NO ACTION today, so Trash → "Delete
-- permanently" on a client raises a foreign-key violation and surfaces as
-- "Couldn't delete — internal".
--
-- This is the same walk, unchanged and idempotent: constraints already marked
-- ON DELETE CASCADE are skipped, so re-running it is a no-op. It is deliberately
-- a fresh migration rather than an edit to 0131 — 0131 is already recorded as
-- applied, so editing it would never re-run.
--
-- Scope is unchanged: the client's OWNED data (folios → transactions / sips,
-- proposals, goals, communications, consents, service requests, gifts, business
-- entries, …). `leads` and `families` do not reference investors, so deleting a
-- client still never deletes a family or a lead.

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    WITH RECURSIVE subgraph(tbl) AS (
      SELECT 'investors'::regclass
      UNION
      SELECT con.conrelid::regclass
      FROM pg_constraint con
      JOIN subgraph s ON con.confrelid = s.tbl
      WHERE con.contype = 'f'
    )
    SELECT con.conname AS name,
           con.conrelid::regclass AS child,
           pg_get_constraintdef(con.oid) AS def
    FROM pg_constraint con
    JOIN subgraph s ON con.confrelid = s.tbl
    WHERE con.contype = 'f'
      AND con.conrelid <> 'investors'::regclass
      AND position('ON DELETE CASCADE' IN pg_get_constraintdef(con.oid)) = 0
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.child, r.name);
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s ON DELETE CASCADE', r.child, r.name, r.def);
  END LOOP;
END $$;
