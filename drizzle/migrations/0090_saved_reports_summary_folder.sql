-- Zoho-style report builder upgrade.
--   folder  — optional folder name to organise reports (All / Favourites are
--             virtual; any other string is a user-created folder).
--   summary — config for the new "summary" report type (row grouping with
--             detail rows + per-group sub-totals + grand totals + multiple
--             aggregate columns). NULL for detailed/matrix reports.
-- The report_type / matrix.aggregate value sets widen at the code layer only
-- (Drizzle `text({enum})` emits no DB CHECK constraint), so no enum change here.

ALTER TABLE saved_reports ADD COLUMN IF NOT EXISTS folder  text;
ALTER TABLE saved_reports ADD COLUMN IF NOT EXISTS summary jsonb;

CREATE INDEX IF NOT EXISTS saved_reports_folder_idx ON saved_reports (tenant_id, folder);
