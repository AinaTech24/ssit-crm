-- P1 SCALE: trigram (pg_trgm) GIN indexes for the global search endpoint.
--
-- /api/search runs `col ILIKE '%q%'` across investors, leads, folios, sips,
-- service_requests and compliance_documents. A leading-wildcard ILIKE can
-- NOT use a B-tree index, so today every search is a sequential scan. At the
-- target scale (500 tenants x 10K clients = ~5M investor rows) that's a
-- multi-hundred-millisecond table scan on every keystroke — the search box
-- becomes unusable and hammers the DB.
--
-- pg_trgm's gin_trgm_ops index type accelerates both LIKE and ILIKE
-- (case-insensitivity is handled by the trigram extraction), turning the
-- substring search into an index lookup. RLS still scopes results by tenant;
-- the index just makes the candidate fetch cheap.
--
-- NB: plain CREATE INDEX (not CONCURRENTLY) because the migration runner wraps
-- each file in a transaction and CONCURRENTLY can't run inside one. On an
-- existing large table you may instead apply these by hand with CONCURRENTLY
-- during a low-traffic window. IF NOT EXISTS keeps this idempotent.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── investors (the big table, searched by name/PAN/phone/email) ───────────
CREATE INDEX IF NOT EXISTS investors_name_trgm_idx  ON investors USING gin (name  gin_trgm_ops);
CREATE INDEX IF NOT EXISTS investors_pan_trgm_idx   ON investors USING gin (pan   gin_trgm_ops);
CREATE INDEX IF NOT EXISTS investors_phone_trgm_idx ON investors USING gin (phone gin_trgm_ops);
CREATE INDEX IF NOT EXISTS investors_email_trgm_idx ON investors USING gin (email gin_trgm_ops);

-- ── leads (name/phone/email) ──────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS leads_name_trgm_idx  ON leads USING gin (name  gin_trgm_ops);
CREATE INDEX IF NOT EXISTS leads_phone_trgm_idx ON leads USING gin (phone gin_trgm_ops);
CREATE INDEX IF NOT EXISTS leads_email_trgm_idx ON leads USING gin (email gin_trgm_ops);

-- ── folios (folio_number) ─────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS folios_folio_number_trgm_idx ON folios USING gin (folio_number gin_trgm_ops);

-- ── sips (scheme name / code) ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS sips_scheme_name_trgm_idx ON sips USING gin (scheme_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS sips_scheme_code_trgm_idx ON sips USING gin (scheme_code gin_trgm_ops);

-- ── service_requests (ticket_no / subject) ────────────────────────────────
CREATE INDEX IF NOT EXISTS service_requests_ticket_no_trgm_idx ON service_requests USING gin (ticket_no gin_trgm_ops);
CREATE INDEX IF NOT EXISTS service_requests_subject_trgm_idx   ON service_requests USING gin (subject   gin_trgm_ops);

-- ── compliance_documents (name) ───────────────────────────────────────────
CREATE INDEX IF NOT EXISTS compliance_documents_name_trgm_idx ON compliance_documents USING gin (name gin_trgm_ops);
