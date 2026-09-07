-- Gifts: record DELIVERY separately from the log entry, and remember whether
-- the client's RM was told.
--
-- given_on is when the gift was decided/logged. Delivery is a different event —
-- often days later, often by someone other than the RM who owns the client —
-- and it is the one the RM actually needs to know about: they are the person
-- who will speak to the client next.
--
-- rm_notified_at exists so the intimation is sent exactly once. Without it a
-- re-save, a retry or a second edit would notify the RM again for the same
-- delivery.

ALTER TABLE client_gifts
  ADD COLUMN IF NOT EXISTS delivered_on date,
  ADD COLUMN IF NOT EXISTS rm_notified_at timestamptz;

-- Drives the "this day last year" reminder scan, which filters on the delivery
-- date (falling back to given_on for rows written before this migration).
CREATE INDEX IF NOT EXISTS client_gifts_delivered_idx
  ON client_gifts (tenant_id, delivered_on);

COMMENT ON COLUMN client_gifts.delivered_on IS
  'When the gift actually reached the client. NULL = logged but not yet delivered.';
COMMENT ON COLUMN client_gifts.rm_notified_at IS
  'When the owning RM was told about the delivery. Set once, so the intimation never repeats.';
