-- Who executed the transaction on the platform (distinct from the RM who owns
-- the client relationship and from created_by, who keyed the entry in).
ALTER TABLE business_entries
  ADD COLUMN IF NOT EXISTS executed_by_id uuid REFERENCES users(id);
