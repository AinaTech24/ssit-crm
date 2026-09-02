-- 0194 — Delete forwarded RTA mail from the catch-all once it has been imported
--
-- The catch-all mailbox accumulates every firm's daily CAMS/KFintech mailback
-- ZIP forever. Those are large and, once imported, redundant: `ingestAttachment`
-- pushes the attachment bytes to S3 BEFORE the import job is queued, so the file
-- survives independently of the mail, and rta_inbound_messages keeps the full
-- audit trail (sender, subject, body snippet, per-attachment verdict).
--
-- Deleting mail is irreversible, so the sweep is deliberately narrow — it only
-- touches a message when ALL of these hold:
--   • outcome = 'imported'                       (something was actually ingested)
--   • every linked rta_file_imports row finished (completed / partial)
--   • it is older than the configured retention window
--   • it still has a Message-ID to match on
-- A failed import (e.g. wrong ZIP password) therefore KEEPS its mail, so it can
-- be reprocessed after the password is fixed.

ALTER TABLE rta_inbound_messages
  ADD COLUMN IF NOT EXISTS mail_deleted_at timestamptz;

COMMENT ON COLUMN rta_inbound_messages.mail_deleted_at IS
  'When the source email was removed from the catch-all mailbox by the cleanup sweep. The log row itself is retained as the audit trail.';

-- Drives the sweep: pending = imported and not yet cleaned up.
CREATE INDEX IF NOT EXISTS rta_inbound_msg_cleanup_idx
  ON rta_inbound_messages (created_at)
  WHERE mail_deleted_at IS NULL AND outcome = 'imported';
