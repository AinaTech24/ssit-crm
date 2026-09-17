-- Re-assert investors.pan is nullable. Idempotent safety net.
--
-- Migration 0129 dropped the NOT NULL constraint on investors.pan so a
-- PAN-less client (very common on a real MFD book — plenty of clients are
-- onboarded before PAN is on file) could be created and imported. But
-- src/db/schema/investors.ts was never updated to match: it still declared
-- pan as .notNull(). Any tool that treats the TypeScript schema as the source
-- of truth (drizzle-kit push, a fresh drizzle-kit generate) would re-impose
-- the NOT NULL constraint and silently undo 0129's migration on whatever
-- database it ran against.
--
-- Symptom this produced: bulk Excel import of any row with a blank PAN column
-- failed the INSERT outright (23502 not-null violation) — the WHOLE row was
-- lost, not just the PAN. Reported as "phone, email not reflected on import"
-- because those are the fields a user notices missing; the actual failure was
-- every field on that row, silently, since the import UI shows a row/error
-- count that is easy to skim past.
--
-- ALTER ... DROP NOT NULL is idempotent — a no-op if the column is already
-- nullable — so this is safe to run everywhere regardless of whether a given
-- database already has 0129's effect or has drifted back to NOT NULL.

ALTER TABLE investors
  ALTER COLUMN pan DROP NOT NULL;
