-- Per-tenant "restrict users to their own data" switch.
--
-- Row-level visibility of CLIENTS (who may see which investor) is a firm policy,
-- not a platform one: some firms run a shared book where every RM helps every
-- client, others need a hard wall between books. Default FALSE keeps the
-- long-standing firm-wide behaviour, so enabling it is an explicit decision per
-- tenant rather than a silent change under a live firm.
--
-- When TRUE, lib/investors/access.ts narrows the client list / export / API to:
--   owner, compliance, back_office, ops -> the whole firm
--   branch_head (with a branch)         -> their branch
--   rm                                  -> clients assigned to them

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS restrict_user_data_scope boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN tenants.restrict_user_data_scope IS
  'When true, users only see the clients their role entitles them to (RM = own book). Default false = firm-wide.';
