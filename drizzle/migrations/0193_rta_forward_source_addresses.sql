-- 0193 — Hybrid RTA mailback addressing: one shared address + registered senders
--
-- Until now the ONLY routing key was the per-firm alias rta-<token>@<domain>.
-- That's the strongest guarantee (the alias is unguessable), but it means every
-- firm sees a different long address — unlike other RTA-import vendors, who
-- publish one address like rta@<domain>.
--
-- This adds the second routing path: a firm registers the mailbox they forward
-- FROM, and mail arriving at the shared rta@<domain> is matched on that sender.
-- The alias stays primary — it's tried first and always wins — so nothing that
-- already works breaks. Sender matching is only consulted when the alias misses.
--
-- Security note: a From header is spoofable, so sender-matching is deliberately
-- the WEAKER, secondary path. Ambiguity (two firms registering the same mailbox)
-- resolves to NO match rather than a guess — see resolveTenantBySenders().

ALTER TABLE rta_forward_addresses
  ADD COLUMN IF NOT EXISTS source_addresses jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN rta_forward_addresses.source_addresses IS
  'Lower-cased mailbox addresses this firm forwards RTA mail FROM. Used to route mail sent to the shared rta@<domain> address when no per-firm alias matched.';

-- Containment lookups (source_addresses @> '["someone@x.com"]') use GIN.
CREATE INDEX IF NOT EXISTS rta_forward_addr_source_gin
  ON rta_forward_addresses USING gin (source_addresses jsonb_path_ops);
