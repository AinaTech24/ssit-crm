-- Per-firm "dormancy window" — how many days without a transaction marks a
-- client dormant. Previously hardcoded inconsistently (copilot tools used 180,
-- the firm snapshot used 365), so the assistant contradicted itself. One
-- tenant-level knob, default 180 to match the Investors KPIs / quick filters /
-- churn report. Additive + idempotent.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS dormancy_window_days integer NOT NULL DEFAULT 180;
