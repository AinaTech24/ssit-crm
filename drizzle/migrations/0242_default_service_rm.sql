-- Every client has a Service RM: the person servicing requests are assigned to.
--
-- Until someone picks a different one, the Service RM is the client's own RM
-- (the form's "Same as assigned RM"). Existing clients with none are filled in
-- now; new clients get it on insert, whichever path creates them (manual, CSV
-- import, lead convert, RTA import). Clients whose Service RM is already set are
-- left alone, and a client with no RM at all stays empty until it has one.

CREATE OR REPLACE FUNCTION investors_default_service_rm() RETURNS trigger AS $$
BEGIN
  IF NEW.service_rm_id IS NULL AND NEW.rm_id IS NOT NULL THEN
    NEW.service_rm_id := NEW.rm_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_investors_default_service_rm ON investors;
CREATE TRIGGER trg_investors_default_service_rm
  BEFORE INSERT ON investors
  FOR EACH ROW EXECUTE FUNCTION investors_default_service_rm();

UPDATE investors
   SET service_rm_id = rm_id
 WHERE service_rm_id IS NULL
   AND rm_id IS NOT NULL;

-- When the RM is reassigned, a Service RM that was just the old RM's default
-- moves with it — otherwise the previous RM would keep getting (and seeing)
-- the client's service requests. A Service RM chosen on purpose (different from
-- the RM) is never touched, and neither is one set in the same update.
CREATE OR REPLACE FUNCTION investors_service_rm_follows_rm() RETURNS trigger AS $$
BEGIN
  IF NEW.rm_id IS DISTINCT FROM OLD.rm_id
     AND OLD.service_rm_id IS NOT DISTINCT FROM OLD.rm_id
     AND NEW.service_rm_id IS NOT DISTINCT FROM OLD.service_rm_id THEN
    NEW.service_rm_id := NEW.rm_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_investors_service_rm_follows_rm ON investors;
CREATE TRIGGER trg_investors_service_rm_follows_rm
  BEFORE UPDATE OF rm_id ON investors
  FOR EACH ROW EXECUTE FUNCTION investors_service_rm_follows_rm();
