-- Default review cadence: every client is reviewed every 100 days unless the RM
-- sets something else.
--
-- 1. New clients (any create path: manual, CSV import, lead convert, RTA import)
--    get review_frequency_days = 100 when no cadence was given, and a
--    next_review_at of (last review, else onboarding, else today) + cadence.
--    Done as a BEFORE INSERT trigger so every insert path is covered at once.
-- 2. Existing clients with no cadence get the same default. Their next review
--    is counted from the last review (else onboarding/creation), so anyone not
--    reviewed in 100 days is immediately "review pending" (next_review_at in
--    the past) in the Reviews due filter.

CREATE OR REPLACE FUNCTION investors_default_review_cadence() RETURNS trigger AS $$
BEGIN
  IF NEW.review_frequency IS NULL AND NEW.review_frequency_days IS NULL THEN
    NEW.review_frequency_days := 100;
  END IF;
  IF NEW.next_review_at IS NULL AND NEW.review_frequency_days IS NOT NULL THEN
    NEW.next_review_at := COALESCE(NEW.last_review_at, NEW.onboarded_at::timestamptz, now())
                          + (NEW.review_frequency_days || ' days')::interval;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_investors_default_review_cadence ON investors;
CREATE TRIGGER trg_investors_default_review_cadence
  BEFORE INSERT ON investors
  FOR EACH ROW EXECUTE FUNCTION investors_default_review_cadence();

-- Backfill existing clients (no cadence set at all).
UPDATE investors
   SET review_frequency_days = 100
 WHERE review_frequency IS NULL AND review_frequency_days IS NULL;

-- Give every active client with a cadence but no next-review date one.
UPDATE investors
   SET next_review_at = COALESCE(last_review_at, onboarded_at::timestamptz, created_at)
                        + (review_frequency_days || ' days')::interval
 WHERE next_review_at IS NULL
   AND review_frequency_days IS NOT NULL
   AND status = 'active';
