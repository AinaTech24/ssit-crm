-- Review pending = 100 days since the last review.
--
-- 0240 gave every client a 100-day cadence but only filled in next_review_at
-- where it was empty, so clients that already carried a (often far-future) date
-- never showed as pending. For everyone on the default 100-day cadence the due
-- date is now derived from when they were last reviewed (else onboarded, else
-- created): anyone not reviewed in 100 days is due immediately, and it moves
-- forward by itself when a review meeting is completed (last_review_at updates).
--
-- Clients on a preset (monthly/quarterly/...) or a custom cadence other than
-- 100 days are left alone.

UPDATE investors
   SET next_review_at = COALESCE(last_review_at, onboarded_at::timestamptz, created_at)
                        + interval '100 days'
 WHERE status = 'active'
   AND deleted_at IS NULL
   AND review_frequency IS NULL
   AND review_frequency_days = 100;
