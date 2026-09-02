-- MOM Tracker — Network FP "2.5 MOM Tracker" parity.
--
-- The existing review_meetings module already covers Meeting Date, Place
-- (meeting_mode + location_or_link), Meeting Type, Key Discussion Points
-- (discussion_points), and Next Steps (action_items jsonb).
--
-- The gap is structured Attendees. A meeting is rarely just RM + client:
-- spouse, adult children, family CA, AMC RM, sub-distributor referrer,
-- back-office staff — any combination shows up depending on the agenda.
-- Track each as a typed entry so the per-client meeting history view
-- can render "Met with Mr. Naronha, his wife, and his CA" instead of
-- losing that context to free-text notes.

ALTER TABLE review_meetings
  ADD COLUMN IF NOT EXISTS attendees jsonb DEFAULT '[]'::jsonb;

-- Structure of each entry (validated app-side by Zod):
--   {
--     name: string,
--     role: 'rm' | 'investor' | 'spouse' | 'family' | 'ca' | 'amc_rm'
--           | 'sub_distributor' | 'back_office' | 'compliance' | 'other',
--     isExternal: boolean,  // true = not a firm employee
--     notes?: string
--   }
