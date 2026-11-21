-- Client engagement: gift categories now include Books and Other.
--
-- "Other" is a free-text category: the person logging the gift types what it was
-- (a pen set, a diary ...) and that text is kept here, next to the category, so it
-- survives editing and shows on the board as "Other (Pen set) · A". The category
-- list itself is enforced in the API (see migration 0210), so only this column is new.

ALTER TABLE client_gifts
  ADD COLUMN IF NOT EXISTS category_other text;

COMMENT ON COLUMN client_gifts.category_other IS
  'What the gift was, typed by the logger, when category = other. NULL otherwise.';
