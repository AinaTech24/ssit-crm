-- Perf + integrity:
--   1. (tenant_id, folio_number) index on folios — the RTA-import hot path
--      (resolve investor by folio, attach transactions/AUM). The existing unique
--      index is (tenant_id, amc_code, folio_number), which can't serve a lookup
--      that omits amc_code.
--   2. Natural-key UNIQUE index on commission_rows (when that table exists) so
--      the brokerage import's `ON CONFLICT DO NOTHING` actually dedupes a
--      re-imported month instead of appending duplicate brokerage rows.

CREATE INDEX IF NOT EXISTS folios_tenant_folio_idx ON folios (tenant_id, folio_number);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'commission_rows') THEN
    CREATE UNIQUE INDEX IF NOT EXISTS commission_rows_natural_unique
      ON commission_rows (tenant_id, amc_code, scheme_code, folio_number, period_start, period_end, brokerage_type);
  END IF;
END $$;
