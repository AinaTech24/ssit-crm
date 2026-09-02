-- 0055 — Meetings: explicit subject / title
--
-- Adopted from the Sanchay meeting form. Until now a meeting's headline was
-- derived from its type + client name, so three "Portfolio Review" meetings in
-- a day were indistinguishable. An optional free-text subject lets the RM name
-- the meeting; it surfaces on the list, today's agenda, the detail header, the
-- .ics invite and the Command Center. Additive on an RLS-protected table.

ALTER TABLE review_meetings
  ADD COLUMN IF NOT EXISTS subject text;
