-- Schema drift fix: users.custom_leave_entitlements.
--
-- The column is defined in the Drizzle schema (src/db/schema/users.ts:128) and
-- read/written by the employee detail page + EmployeeEditForm ("Custom Leave
-- Entitlements & Comp-offs"), but no migration ever added it to the database.
-- Drizzle's `tx.select().from(users)` lists EVERY schema column explicitly, so
-- the employee detail page query failed with 42703 "column
-- custom_leave_entitlements does not exist" and every employee profile hit the
-- error boundary ("Something went wrong"). Add the missing nullable jsonb column.
-- Idempotent.

ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_leave_entitlements jsonb;
