-- AMC empanelments: which PRODUCT LINE the empanelment covers.
--
-- The table modelled the relationship as one row per AMC, but a firm empanels
-- separately per product: the MF agreement, the PMS/AIF agreement and the
-- insurance tie-up are different contracts with different codes, different
-- contacts and different renewal dates. Without this the list cannot answer
-- "which insurers are we empanelled with", which is the question that sends
-- someone to this page.
--
-- Nullable, and NOT back-filled to 'mf'. Every existing row predates the field,
-- so we genuinely do not know what it covers — guessing would put a confident
-- wrong label on real contracts. They show as "Uncategorised" until someone
-- sets them.

ALTER TABLE amc_empanelments
  ADD COLUMN IF NOT EXISTS category text;

CREATE INDEX IF NOT EXISTS amc_empanelments_category_idx
  ON amc_empanelments (tenant_id, category);

COMMENT ON COLUMN amc_empanelments.category IS
  'Product line this empanelment covers: mf | pms_aif | insurance | las | unlisted_share. NULL = not yet categorised.';
