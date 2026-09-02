-- 0126 — capture the recurring SIP installment day (ECS date) on a business
-- entry's SIP line, so a SIP registered via Business Entries carries the debit
-- day that drives reminder workflows (mirrors sips.sip_date: day of month "1".."28").

ALTER TABLE business_entry_lines ADD COLUMN IF NOT EXISTS sip_date text;
