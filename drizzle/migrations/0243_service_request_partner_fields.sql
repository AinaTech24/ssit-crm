-- Service requests: who the client is, which desk/partner it concerns, and the
-- running log of mail / call updates exchanged with the partner about the query.
--   client_name     typed name when the ticket is not tied to a client record
--   client_code     the client's code at the partner (MF / MO / ...) - snapshot
--   department      Motilal Oswal | MF | Demat | Insurance
--   partner_name    the partner the query was raised with (firm-managed list)
--   partner_update  mail / call updation with the partner, and the query
ALTER TABLE service_requests
  ADD COLUMN IF NOT EXISTS client_name text,
  ADD COLUMN IF NOT EXISTS client_code text,
  ADD COLUMN IF NOT EXISTS department text,
  ADD COLUMN IF NOT EXISTS partner_name text,
  ADD COLUMN IF NOT EXISTS partner_update text;
