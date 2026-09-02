-- 0143 — Glide-path / de-risking profile per goal. The effective expected
-- return is shaved as the target date nears (none = base return holds).

ALTER TABLE goals
  ADD COLUMN IF NOT EXISTS glide_path text NOT NULL DEFAULT 'none';
