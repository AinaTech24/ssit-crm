-- Add target_mode, present_target_amount, inflation_pct, and step_up_pct to goals table
ALTER TABLE goals ADD COLUMN IF NOT EXISTS target_mode text DEFAULT 'future';
ALTER TABLE goals ADD COLUMN IF NOT EXISTS present_target_amount numeric(18,2);
ALTER TABLE goals ADD COLUMN IF NOT EXISTS inflation_pct numeric(5,2);
ALTER TABLE goals ADD COLUMN IF NOT EXISTS step_up_pct numeric(5,2);
