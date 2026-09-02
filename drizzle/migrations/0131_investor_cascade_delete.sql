-- Permanent client (investor) deletion.
--
-- Investor FKs are RESTRICT, so a plain DELETE on an investor fails with a
-- foreign-key violation. This migration makes the investor's OWNED-DATA subgraph
-- cascade: it walks the FK graph starting at `investors`, and converts every FK
-- whose PARENT table is part of that subgraph to ON DELETE CASCADE.
--
-- Scope is exactly the owned financial/CRM records (folios -> transactions /
-- sips / portfolio_review_items, proposals -> schemes / approvals, sips ->
-- installment_marks, insurance -> claims, goals, communications, consents,
-- equity, reconciliation, service_requests, business_entries, calc_scenarios,
-- financial_plans, …). `leads` and `families` do NOT FK-reference investors, so
-- they are untouched — deleting a client never deletes the family or lead.
--
-- Idempotent: re-running skips FKs already marked ON DELETE CASCADE.

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
