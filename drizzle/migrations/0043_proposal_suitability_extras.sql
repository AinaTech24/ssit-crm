-- Add suitability_note and suitability_override_reason columns to proposals table
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS suitability_note text;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS suitability_override_reason text;
