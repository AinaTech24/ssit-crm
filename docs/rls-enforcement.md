# Enforcing Row-Level Security (tenant isolation cut-over)

**Status:** the app is built for RLS but ships connecting as the Postgres
**superuser**, which *bypasses* RLS. Until you complete the cut-over below,
tenant isolation rests on explicit `tenant_id` predicates in app code — strong
on the list/detail paths, but the **dashboard aggregation queries rely on RLS**
and are therefore cross-tenant while RLS is bypassed.

Flipping the app to the non-superuser `mfd_app` role turns on every
`tenant_isolation` policy and closes that gap **at the database layer, for every
query at once** — no per-query predicate bolting required.

This is intentionally **opt-in**: nothing changes until you set
`APP_DATABASE_URL`.

---

## Why this is safe by design

| Helper (`src/db/client.ts`) | Sets session var | Under `mfd_app` (RLS on) |
|---|---|---|
| `withTenant(tenantId, …)` | `app.tenant_id` | sees only that tenant's rows |
| `withPlatformAdmin(uid, …)` | `app.is_platform_admin=true` | sees all tenants (SSIT super-admin) |
| `withSystem(…)` | `app.is_platform_admin=true` | sees all tenants (poller, materializer) |
| bare `db.execute(...)` (no wrapper) | — | sees **zero** rows |

The RLS policy on every tenant table is:

```sql
USING      (tenant_id = app_tenant_id() OR app_is_platform_admin())
WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform_admin())
```

So `withSystem`/`withPlatformAdmin` keep working as a non-superuser — they go
through the `app_is_platform_admin()` branch, not a superuser bypass.

**Context-free reads** (bare `db.*` outside any wrapper) return zero rows under
enforcement. Audited 2026-06: the codebase has exactly **one**, in
`GrowthRetentionSection.tsx`, and it targets `amfi_circulars` — a platform-shared
table with **no `tenant_id` and no RLS** — so it is unaffected. No code changes
are required for the cut-over.

---

## Cut-over procedure

> Migrations, seed, and backfills keep using the privileged `DATABASE_URL`
> (they need DDL). Only the **app process** (and the worker) switch to
> `APP_DATABASE_URL`.

### 1. Provision the role (idempotent)

```bash
APP_DB_PASSWORD='<a-strong-password>' npm run db:provision-app-role
```

Creates `mfd_app` as `NOSUPERUSER NOBYPASSRLS` with least-privilege DML grants
(`SELECT/INSERT/UPDATE/DELETE` on all tables, `USAGE/SELECT/UPDATE` on
sequences) plus default privileges so future migrated tables are auto-granted.

### 2. Verify isolation BEFORE pointing the app at it

```bash
APP_DB_PASSWORD='<same-password>' node scripts/verify-rls-isolation.mjs
```

Connects **as `mfd_app`** and asserts (all read-only / rolled back):

- the role is not superuser and not bypassrls;
- `withTenant(A)` sees exactly tenant A's rows and **zero** of tenant B's;
- a context-free read returns **zero** rows (proves RLS is active);
- a platform-admin context sees **all** rows (poller/materializer path);
- a cross-tenant write under tenant A touches **zero** of tenant B's rows.

Exit code 0 = green. **Do not proceed unless green.**

### 3. Point the app + worker at the role (do NOT commit this)

```bash
# .env.local  (or your process manager's env)
APP_DATABASE_URL=postgres://mfd_app:<password>@localhost:5432/mfd
```

### 4. Restart the app and the worker

On boot, `assertNonBypassingRole()` (in `src/db/client.ts`) confirms the
connected role is non-privileged. In production it **hard-exits** if the app is
still on a superuser/bypassrls role (override only via `ALLOW_SUPERUSER_DB=1`).

### 5. Smoke-test

- Log in as two different tenants → dashboards show each firm's own numbers.
- Run a workflow / a campaign send → `withSystem` paths still work (worker).
- Check the worker log → outbox poller and segment materializer still drain.

---

## Rollback

Unset `APP_DATABASE_URL` and restart. The app falls back to `DATABASE_URL`
(superuser) immediately — RLS goes back to bypassed, explicit predicates remain
the protection. No schema or data changes are involved, so rollback is instant.

---

## Notes

- The dashboard cockpits *also* carry explicit `tenant_id` predicates on the
  primary owner cockpit (`OwnerCockpit.tsx`) as defense-in-depth — these are
  correct with or without RLS and need no change.
- `check:rls` (CI) asserts every `tenant_id` table has RLS **enabled + forced +
  a `tenant_isolation` policy** (currently 98/98). That guarantees the policies
  exist; this cut-over is what makes them *enforced* at runtime.
