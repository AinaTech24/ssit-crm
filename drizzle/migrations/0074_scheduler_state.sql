-- Worker scheduler state — operational metadata (NOT tenant-scoped).
--
-- Powers two reliability features:
--   • missed-run catch-up: on boot, a fixed-time job whose last_run_at predates
--     today's scheduled time (because the process was down at that moment) runs
--     immediately instead of silently skipping the day.
--   • liveness: each scheduler bumps last_heartbeat_at so a readiness probe can
--     flag a stalled/dead worker (the web app can be green while automation is
--     dead — this surfaces that).
--
-- Global table (no tenant_id) written under withSystem; no RLS needed.

CREATE TABLE IF NOT EXISTS scheduler_state (
  job_name text PRIMARY KEY,
  last_run_at timestamptz,
  last_run_status text,
  last_run_detail text,
  last_heartbeat_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
