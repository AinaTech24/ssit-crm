-- Dhandho session notes.
--
-- After each daily session someone writes down what was shared (the day's topic and
-- the learning). The notes live on the session row, so they sit next to the topic on
-- the Dhandho page, and saving them can notify the whole team.
--
-- Who may write them is a new capability, dhandho.notes (the owner always can; the
-- day's own speaker can too). It is a brand-new capability, so no existing
-- users.permissions list needs a backfill - nobody loses anything they had.
ALTER TABLE dhandho_sessions
  ADD COLUMN IF NOT EXISTS notes     text,
  ADD COLUMN IF NOT EXISTS notes_by  uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS notes_at  timestamptz;
