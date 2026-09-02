-- Make amfi_circulars.circular_no unique.
--
-- The schema documented circular_no as "Unique" but only declared a plain
-- index, so duplicate circulars could be inserted into the platform-shared
-- digest. This migration dedups defensively (keeps the newest row per
-- circular_no) and then swaps the non-unique index for a unique one.

-- 1. Remove older duplicates: keep the most-recently-created row per
--    circular_no, tie-breaking on id so the delete is deterministic.
DELETE FROM amfi_circulars a
USING amfi_circulars b
WHERE a.circular_no = b.circular_no
  AND (a.created_at < b.created_at OR (a.created_at = b.created_at AND a.id < b.id));

-- 2. Replace the non-unique index with a unique one (same name).
DROP INDEX IF EXISTS amfi_circulars_circular_no_idx;
CREATE UNIQUE INDEX IF NOT EXISTS amfi_circulars_circular_no_idx ON amfi_circulars (circular_no);
