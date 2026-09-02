-- Admin → MFD dashboard-widget access control.
-- Adds the per-tenant grant of which dashboard home cards/sections a firm can
-- see. NULL = all widgets visible (default); an array = exactly those widget
-- keys are shown. Idempotent so it is safe to re-run / replay.
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS allowed_dashboard_widgets jsonb;
