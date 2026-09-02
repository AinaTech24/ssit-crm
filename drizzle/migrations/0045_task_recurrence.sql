-- Recurring tasks (adopted from the Sanchay "Enable Recurring" pattern).
--
-- A task can repeat on a cadence. We use the "chain-on-completion" model:
-- when a recurring task is marked completed, the API spawns the next
-- occurrence with its due date advanced by the cadence. This avoids the
-- pile-up problem of unconditionally materialising every future occurrence.
--
-- `tasks` is already an RLS-protected domain table (tenant_isolation policy
-- applies to all columns), so these additive columns need no new policy.

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS recurrence text,            -- daily|weekly|monthly|quarterly|yearly  (NULL = one-off)
  ADD COLUMN IF NOT EXISTS recurrence_until date,      -- optional: stop spawning after this date
  ADD COLUMN IF NOT EXISTS recurrence_parent_id uuid;  -- chain root, for grouping a recurring series

-- Cheap lookup of active recurring templates per tenant.
CREATE INDEX IF NOT EXISTS tasks_recurrence_idx
  ON tasks (tenant_id, recurrence)
  WHERE recurrence IS NOT NULL;
