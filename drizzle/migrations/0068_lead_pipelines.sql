-- 0068 — Multiple Pipelines (Zoho parity) for MFD + insurance.
-- A lightweight pipeline layer on leads so a Mutual-Fund sale and an Insurance
-- sale run as separate stage flows, without touching the 30-stage blueprint.
-- Columns added to an existing table → leads already carries tenant_isolation.

ALTER TABLE leads ADD COLUMN IF NOT EXISTS pipeline text NOT NULL DEFAULT 'mf';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS pipeline_stage text;

CREATE INDEX IF NOT EXISTS leads_pipeline_idx ON leads (tenant_id, pipeline, pipeline_stage);
