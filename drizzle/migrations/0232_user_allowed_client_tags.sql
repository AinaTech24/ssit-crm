-- Restrict a user to certain client BOOKS.
--
-- A firm's back office is not one desk. One person runs the Motilal Oswal
-- book, another runs Mutual Fund, and each should see their own clients —
-- but back_office is a firm-wide role in the data wall, so every one of them
-- saw the entire client list.
--
-- The book already exists as a TAG on the client (investors.tags, see
-- lib/investors/client-tags.ts: "Motilal Oswal", "Mutual Fund"). This is the
-- other half: which books a given user is allowed to see.
--
--   NULL / []  → no restriction, as today
--   ['Mutual Fund']              → only clients tagged Mutual Fund
--   ['Motilal Oswal','Mutual Fund'] → either
--
-- NARROWING ONLY. It is ANDed with the data wall, never instead of it, so it
-- can take clients away from someone and never hand them any. Matching is
-- case-insensitive, because a tag typed by hand does not always match the chip.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS allowed_client_tags jsonb;

COMMENT ON COLUMN users.allowed_client_tags IS
  'Client book tags this user may see (investors.tags). NULL/[] = no restriction. Narrows the data wall, never widens it.';
