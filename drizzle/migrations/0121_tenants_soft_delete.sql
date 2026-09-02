-- 0121 — soft-delete for tenants.
--
-- Adds deleted_at / deleted_by so a platform admin can "delete" a tenant from
-- the super-admin panel without an irreversible hard purge. Domain `tenant_id`
-- columns carry NO foreign key to tenants, and domain tables have inter-table
-- FKs with unknown delete order, so a blind cascade purge would either FK-fail
-- or orphan rows. Soft delete is reversible and corruption-free: the row is
-- hidden from the tenants list and its users are blocked from logging in.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS deleted_by uuid;
