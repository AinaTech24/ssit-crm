-- Several clock-in / clock-out sessions in one day (lunch, field visit, back
-- after hours). Each session is {"in": ISO, "out": ISO | null}; the existing
-- clock_in_at / clock_out_at / total_minutes columns stay as the day's summary
-- (first in, last out, minutes summed over closed sessions) so reports and
-- policy flags keep working untouched. NULL = a day punched before this existed.
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS punches jsonb;
