-- Meetings: replace the single "assigned RM" with a creator + collaborators.
--
-- rm_id did two jobs at once:
--   1. who the meeting belongs to (access control: a non-manager may only touch
--      a meeting where rm_id = their user id)
--   2. who inherits the action-item tasks fanned out on completion
--
-- Splitting those apart:
--   created_by_id   the owner — drives access control AND action-item ownership
--   collaborator_ids  everyone else invited, many per meeting
--
-- rm_id is intentionally NOT dropped. It is the only record of who owned every
-- historical meeting, and a drop is irreversible; the app stops reading it, and
-- created_by_id is backfilled from it so existing rows keep working.

ALTER TABLE review_meetings
  ADD COLUMN IF NOT EXISTS created_by_id uuid,
  ADD COLUMN IF NOT EXISTS collaborator_ids jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Backfill: the old RM was effectively the owner, so carry that across. Without
-- this every pre-existing meeting would become unreachable for its own RM the
-- moment access control switches to created_by_id.
UPDATE review_meetings
   SET created_by_id = rm_id
 WHERE created_by_id IS NULL
   AND rm_id IS NOT NULL;

-- Same shape as the rm_id index it replaces — access control filters on this.
CREATE INDEX IF NOT EXISTS rm_created_by_idx
  ON review_meetings (tenant_id, created_by_id, meeting_date);

COMMENT ON COLUMN review_meetings.created_by_id IS
  'Meeting owner. Drives access control and inherits fanned-out action items.';
COMMENT ON COLUMN review_meetings.collaborator_ids IS
  'jsonb array of user ids invited alongside the creator.';
COMMENT ON COLUMN review_meetings.rm_id IS
  'DEPRECATED — superseded by created_by_id. Retained for historical rows only; nothing reads it.';
