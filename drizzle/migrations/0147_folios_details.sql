-- Extra folio attributes captured on import (holding mode, status, bank,
-- nominee, invested/current value, XIRR, units, SIP flag, …) that don't have
-- dedicated columns. Mirrors the investors.details pattern — migration-free to
-- extend. The MF-transactions Excel import upserts these onto the folio the
-- transaction belongs to.

ALTER TABLE folios ADD COLUMN IF NOT EXISTS details jsonb DEFAULT '{}'::jsonb;
