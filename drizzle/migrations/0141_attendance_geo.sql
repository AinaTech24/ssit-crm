-- 0141 — Geolocation + IP capture on attendance punches (field-attendance proof).

ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS clock_in_lat numeric,
  ADD COLUMN IF NOT EXISTS clock_in_lng numeric,
  ADD COLUMN IF NOT EXISTS clock_in_ip text,
  ADD COLUMN IF NOT EXISTS clock_out_lat numeric,
  ADD COLUMN IF NOT EXISTS clock_out_lng numeric,
  ADD COLUMN IF NOT EXISTS clock_out_ip text;
