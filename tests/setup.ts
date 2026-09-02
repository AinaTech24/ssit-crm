/**
 * Vitest global setup — runs before any test module is imported.
 *
 * Several unit tests statically import modules that construct the pg Pool at load
 * time (via `@/db/client`, e.g. the billing / comms adapters pulled in by the
 * webhook-signature tests). That module throws "DATABASE_URL is not set" if the
 * env var is absent — even though those tests never touch the database. Provide a
 * dummy URL so the Pool can be constructed (it connects lazily, so nothing is
 * dialed). DB-backed tests still gate on TEST_DATABASE_URL and set the real URL
 * themselves.
 */
process.env.DATABASE_URL ||=
  process.env.TEST_DATABASE_URL || "postgres://test:test@127.0.0.1:5432/ssit_test";
