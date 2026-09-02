-- 0146 — Rich reconciliation summary on each RTA import (investors/folios
-- created vs updated, AUM, per-AMC breakdown, data-drift) so the import detail
-- can show what actually changed.

ALTER TABLE rta_file_imports
  ADD COLUMN IF NOT EXISTS summary jsonb;
