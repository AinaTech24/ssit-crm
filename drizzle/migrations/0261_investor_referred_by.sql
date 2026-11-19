-- "Referred by" on a client: the existing client who brought this client in.
--
-- Until now a referral was only recorded on the LEAD (leads.referred_by_investor_id),
-- so a client who was referred but never came through a lead - added directly, or
-- imported - had nowhere to say who referred them, and the referrer's profile and
-- the Referrals module could not list them.
--
-- Nullable, no FK (matches leads.referred_by_investor_id); the API checks the referrer
-- belongs to the same firm and is not the client itself.
ALTER TABLE investors ADD COLUMN IF NOT EXISTS referred_by_investor_id uuid;

CREATE INDEX IF NOT EXISTS investors_referred_by_idx
  ON investors (tenant_id, referred_by_investor_id)
  WHERE referred_by_investor_id IS NOT NULL;

-- Clients that were converted from a referred lead already know who referred them:
-- carry it across so their profile shows it. Referral counts are unchanged because
-- the Referrals module counts such a client once (see the dedupe in its query).
UPDATE investors n
SET referred_by_investor_id = l.referred_by_investor_id
FROM leads l
WHERE l.converted_investor_id = n.id
  AND l.tenant_id = n.tenant_id
  AND l.referred_by_investor_id IS NOT NULL
  AND l.referred_by_investor_id <> n.id
  AND n.referred_by_investor_id IS NULL;
