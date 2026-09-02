# MFD Growth OS — Final Audit

Brutal but accurate. Cites are file + line numbers. Grouped by severity and what blocks the next milestone.

---

## P0 — Must fix before MFD #1 (security + correctness)

### Filter / Segment compiler is broken or unsafe

`src/lib/filter/compiler.ts:212` returns `{ sql, params }` with `$1`, `$2` placeholders. **Every caller drops `params`** and runs `sql.raw(querySql)`:
- `src/app/api/segments/preview/route.ts:38-39`
- `src/app/api/segments/route.ts:76`
- `src/workers/segment-materializer.ts:42-43`

This either crashes at runtime, or where values flow through the `intervalSql()` regex-strip path (`compiler.ts:247`), exposes SQLi via saved segment ASTs. Saved ASTs are tenant-writable. **Wire the params array through every callsite.**

### Public-form endpoints run inside `withSystem()`

`src/app/api/public/risk-profile/submit/route.ts:49`, `docs/submit/route.ts:38`, `proposals/accept/route.ts:32` — the whole transaction runs as system-bypass after a token lookup. They cross-check token kind, but inside a system tx they can UPDATE *any* lead, investor or proposal by uuid. If the token-id flow ever gets a `?tokenId=` bug, cross-tenant write is open.

**Fix:** resolve the token in a tiny `withSystem` block, then run the rest inside `withTenant(tk.tenantId, …)`.

### 84 of 114 mutation routes have no `requireCap()`

Grep shows the create paths gate (`investors POST` uses `require()`), but PATCH/DELETE siblings don't. Confirmed leaks:
- `src/app/api/investors/[id]/route.ts:97, :134` — any logged-in user can edit any investor
- `src/app/api/segments/[id]/route.ts`
- `src/app/api/onboarding/[id]/stage/route.ts`
- `src/app/api/proposals/[id]/send/route.ts`

**Fix:** add a CI grep check that every `POST|PUT|PATCH|DELETE` exporter in `src/app/api/**` references `require(` or `requirePlatform(`.

### No rate limiting anywhere

No `rateLimit|ratelimit` matches in the codebase. These endpoints are exposed:
- `/api/auth/login`, `/api/auth/signup`, `/api/auth/forgot`
- `/api/public/risk-profile/submit`, `/api/public/docs/submit`, `/api/public/proposals/accept`

Credential stuffing, S3-upload spam, OTP enumeration all open. **Fix:** Upstash redis token bucket; 10 failed logins = 4 hour ban.

### Dev-only auth bypass not gated for prod

`src/middleware.ts:64` honours `NO_AUTH=1` → impersonates owner/rm/compliance. `src/lib/auth/session.ts:115` `devSession()` does the same. If `NO_AUTH` ever leaks into a prod env it's full takeover. **Fix:** wrap both in `if (process.env.NODE_ENV === "production") throw`.

---

## P1 — Fix before tenant #50 (correctness + scale)

### `tenants.attempts` is text, not int

`src/workers/outbox-poller.ts:60-65` increments via `(COALESCE(attempts,'0')::int + 1)::text`. Two concurrent retries race past each other. **Change `events_outbox.attempts` column to `integer`.**

### N+1 inserts in segment materializer

`src/app/api/segments/route.ts:77-82` and `src/workers/segment-materializer.ts:70-77` insert memberships one row at a time. At 100K matches that's 100K round-trips inside a single tx. **Batch via multi-row insert.**

### Audit-log payload size unbounded

`src/app/api/investors/[id]/route.ts:159` dumps the full `inserted[0]` row into `audit_log.after`. Multiply by every mutation × 5M clients × 5 years = terabytes of audit storage. **Cap field size to 4 KB and truncate with a marker.**

### Workflow-runs JSONB query has no index

`src/workers/outbox-poller.ts:139` queries `wait_predicate->>'eventKind'` on every tick. No GIN index on the JSONB field. At 5M rows = sequential scan every 200 ms.

### Outbox poller partial index

`events_outbox(processed_at) WHERE processed_at IS NULL` is the hot scan. Verify partial index exists in `0001_rls_policies.sql` or a follow-up migration.

### Error response leakage

Half the routes return `{ error: err.message }` — leaks PG error codes and stack hints. `/api/investors/route.ts:113`, `/api/leads/route.ts:51`. **Wrap in a discriminator: respond `{ error: "internal" }` to clients, log full message server-side.**

### Inconsistent license gating

`assertActiveLicense` is on `investors/route.ts:121` and `leads/route.ts:65` but missing from `proposals`, `service-requests`, `tasks`, `review-meetings`. A frozen tenant can still create rows in those modules.

---

## P1 — Feature gaps that block real revenue

You cannot actually sell a "transaction CRM" without these. Be honest with prospects about what works, or ship them.

### BSE Star MF / NSE NMF II execution — stub only

`src/lib/integrations/bse-star-mf.ts` is 150 lines of `throw new Error("not implemented")`. **Without this, no order can be placed.** The transaction module is read-only RTA-import for now.

### CAMS / KFintech reverse feed parser — stub only

`src/lib/integrations/cams-feed-parser.ts` is 183 lines, also a stub. No daily reconciliation = stale AUM = the Quarterly Review reports are decorative.

### Razorpay billing — scaffold, not flow

`src/lib/billing/razorpay.ts` (162 lines) has webhook signature verify but no `create-subscription`, `cancel`, or `invoice` issuance. **You cannot actually charge MFDs today.**

### DPDP retention worker — missing

`auditLog.piiAccessed` is logged but there's no scheduled job to enforce the 7-year retention rule. SEBI auditor will ask.

### DLT SMS template registry — missing schema

WhatsApp has its `whatsapp_templates` table; SMS has nothing equivalent. MSG91 won't accept marketing sends without TM/PE/SE entity id + content template id pre-registered.

### EUIN validation at order time — missing

`transactions.euin` column exists but no check that an active EUIN is present on order create. AMFI code: missing EUIN = transaction void.

### GST invoice numbering — missing entirely

No `invoices` table, no monthly numbering sequence. Required for any paid SaaS subscription in India.

---

## P2 — Polish + UX (do during pilot phase)

### Stub-ish UI pages with TODO markers

Grep found "TODO/Coming soon/placeholder" in:
- `/dashboard/ai-assistant`
- `/dashboard/audit-log`
- `/dashboard/help`
- `/dashboard/referrals`
- `/dashboard/sip-rejections`
- `/dashboard/support`

Not 404s, but they signal incomplete UX.

### Cursor pagination missing on big lists

Audit log reads last 500 unbounded. Communications reads 200. Transactions reads 200. Fine at 50 K rows, brutal at 50 M. **Switch to `WHERE created_at < $cursor ORDER BY created_at DESC LIMIT 50`.**

### JSON deep-clone allocations on every render

`src/app/dashboard/workflows/[id]/page.tsx:55-58` does `JSON.parse(JSON.stringify(data.workflow))` on each render. Allocates MB-scale objects. **Pass clean DTOs.**

### Email designer preview iframe — verify XSS escape

`src/app/api/email-designer/preview/route.ts:53` renders tenant-supplied AST to HTML. Confirm `renderEmailHtml` escapes all user-supplied text and rejects raw-HTML blocks from marketing role.

### Compound indexes missing on hot joins

`src/app/api/investors/[id]/route.ts:53-65` runs 6 parallel queries against `communications`, `tasks`, `service_requests` all ordered `desc(created_at).limit(10)`. None of those tables have compound `(investor_id, created_at desc)` indexes that I can see. Each query becomes sort-then-limit at scale.

---

## What's actually great (preserve and replicate)

1. **RLS coverage is comprehensive.** Every domain table I sampled (`blueprint_definitions`, `share_tokens`, `proposal_approvals`, `rta_file_imports`, `workflow_rules`, `content_posts`) has `tenant_isolation` + `FORCE ROW LEVEL SECURITY`. Genuinely good.
2. **`withTenant` / `withSystem` / `withPlatformAdmin` separation** in `src/db/client.ts` is the right shape. `withSystem` gated behind `ALLOW_SYSTEM_TX`.
3. **Outbox uses `FOR UPDATE SKIP LOCKED`** (`outbox-poller.ts:30-44`) — correct concurrency pattern for queue-on-Postgres.
4. **Capability matrix in rbac.ts** is clean and declarative.
5. **HMR pool guard** in `src/db/client.ts:30-52` is the lesson learned from real pain — replicate to any future singleton (Redis client, S3 client, BullMQ queues).
6. **Public form tokens** are hashed (`share_tokens`), single-use enforced.
7. **Webhook idempotency** (signature → external_id → status update) is solid.
8. **Drizzle + Zod end-to-end** with `safeParse` on every payload is consistently applied.
9. **The new blueprint designer + self-healing dev wrapper + column manager + related-list manager** ship the Zoho-style customisation that was missing.

---

## The top-5 list — fix these before MFD #51

1. **Wire `params` array through every `compileToSql` caller** + add a CI smoke test that saved-segment ASTs cannot inject SQL. Ship today.
2. **Sweep mutation routes for `requireCap()`** — CI grep check + audit pass. 84 routes need a one-liner each. One afternoon of work.
3. **Move public-form work back inside `withTenant(tk.tenantId, …)`** after the token resolves. Three files.
4. **Add app-layer rate limiting** to `/api/auth/*` and `/api/public/*`. Upstash + ~50 lines of middleware.
5. **Implement BSE Star MF + CAMS WB consolidated feed** — or be honest with prospects that you're a CRM, not a transaction platform. MFDs at scale will not pay ₹5K-10K/month for "send WhatsApp" alone.

After those five, you have a product that's safe to sell. Everything else in this audit is a roadmap, not a blocker.
