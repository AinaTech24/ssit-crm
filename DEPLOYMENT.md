# Production deployment guide — SSIT CRM

Target: **500+ MFDs × 10 000+ clients each ≈ 5 M clients, ~2.5 B transactions over 5 years.**

This is a real-scale workload. Below is the deployment path I'd take for *this codebase*, organised so you can execute it phase-by-phase rather than over-engineering from day one.

---

## 0. Sanity-check the numbers

| Quantity | At launch (50 MFDs) | At target (500 MFDs) | What it implies |
|---|---|---|---|
| Tenants | 50 | 500 | RLS scoping per request is non-negotiable |
| Clients | 500 K | 5 M | Indexes on `investors(tenant_id, …)` must be tight |
| SIPs (~3 per client) | 1.5 M | 15 M | Daily SIP-due jobs must batch, not loop |
| Transactions (10 yrs × 5/yr/client) | 25 M | 250 M | Partition `transactions` by `order_date` after year 1 |
| Communications/yr (~10 per client) | 5 M | 50 M | Comms log will be the biggest table |
| Concurrent users at peak | ~200 | ~2 000 | Single web instance won't survive — need horizontal scale |
| Background jobs/day | ~500 K | ~5 M | Dedicated worker fleet, not co-located with web |

If you're at 5 MFDs today, **don't deploy for 500**. Phase it (§13).

---

## 0.5. Quick start — the actual commands

Whatever host you choose (§1–2), the platform is **three processes** (web,
worker, + Postgres/Redis) and this exact bring-up order. The repo already ships
`ecosystem.config.cjs` (pm2) and `docker-compose.yml`.

```bash
cp .env.example .env              # fill real values (see §6 + the var table below)
npm ci
npm run db:provision-app-role     # 1. creates the NON-SUPERUSER mfd_app role (needs APP_DB_PASSWORD)
npm run migrate:all               # 2. applies drizzle/migrations/*.sql in order (0001…latest)
npm run seed                      # 3. installs the pre-built workflow recipes
npm run recipes:enable            # 4. publishes/enables default recipes (optional)
npm run refresh:nav               # 5. pulls the AMFI NAV master so valuations price
# 6. only when importing an existing book:
npm run backfill:aum && npm run backfill:investor-health && npm run backfill:family-health
npm run build                     # 7. production build
pm2 start ecosystem.config.cjs    # 8. start web + worker, supervised
pm2 save && pm2 startup           # survive reboots (run the printed command)
```

**The non-superuser DB role is not optional.** The web app connects via
`APP_DATABASE_URL` as the `mfd_app` role (`LOGIN NOSUPERUSER NOBYPASSRLS`) so
Postgres RLS is actually enforced — a superuser silently *bypasses* RLS even
with policies in place. The app **hard-fails on boot in production** if its DB
role can bypass RLS (override only with `ALLOW_SUPERUSER_DB=1`, which you should
never set in prod). Keep `DATABASE_URL` (superuser) for migrations/provisioning
only; the runtime web/worker env should carry `APP_DATABASE_URL`, not the
superuser URL.

**The worker must be supervised.** It drives *all* time-based automation
(daily-ops 06:30, NAV refresh, reconciliation 07:30, statements 08:00, market +
feed scanners, schedulers) on in-process timers. If it dies unsupervised,
automation silently stops with nothing on screen — that's the #1 ops trap.
`ecosystem.config.cjs` gives both `mfd-web` and `mfd-worker` `autorestart`.

### Runtime environment variables added during production hardening

These are **in addition** to the `.env.example` keys (DB, Redis, Resend,
AiSensy, MSG91, Anthropic, S3):

| Var | Where | Purpose |
|---|---|---|
| `APP_DATABASE_URL` 🔒 | web + worker | The `mfd_app` non-superuser connection (RLS enforced) |
| `APP_DB_PASSWORD` 🔒 | provisioning | Password for the role `db:provision-app-role` creates |
| `DATABASE_URL` 🔒 | migrations only | Superuser — `migrate:all` + `provision-app-role` |
| `ALLOW_SYSTEM_TX=1` | **worker only** | Legitimate cross-tenant scans. **Never on web** |
| `HEALTH_TOKEN` 🔒 | web | Guards `GET /api/health/workers` (automation-freshness probe) |
| `ERROR_WEBHOOK_URL` 🔒 | worker | Pushes uncaught worker errors to Slack/ops |
| `DAILY_OPS_CONCURRENCY` / `RECON_CONCURRENCY` | worker | Nightly per-tenant fan-out width (default 5) |
| `VALUATION_CACHE_TTL_MS` | web | Per-investor valuation cache (default 600000) |
| `WORKER_GROUPS` | worker | Split the worker across processes at scale (§13) |

---

## 1. Region & hosting

**Region: AWS Mumbai (`ap-south-1`).** SEBI + DPDP Act require Indian data residency for KYC, transaction, and PII data. Avoid Singapore / Frankfurt regardless of latency.

**Hosting recommendation by stage:**

| Stage | Tenants | Hosting | Monthly infra |
|---|---|---|---|
| Pilot | 1–10 | Single EC2 `t3.large` + RDS `db.t3.medium` + ElastiCache `cache.t3.micro` | ₹15–25 K |
| Phase 1 | 10–50 | 2× EC2 `t3.xlarge` behind ALB + RDS `db.t3.large` (Multi-AZ) + ElastiCache `cache.t3.small` | ₹50–80 K |
| Phase 2 | 50–200 | ECS Fargate (web + workers), RDS `db.r6g.xlarge` + 1 read replica, ElastiCache `cache.r6g.large` | ₹2–3 L |
| Phase 3 | 200–500+ | ECS Fargate auto-scaled, Aurora Postgres `db.r6g.2xlarge` + 2 read replicas, ElastiCache cluster, CloudFront | ₹6–10 L |

**Don't use Vercel for this.** It's great for static + serverless, but: (a) BullMQ workers need long-lived processes; (b) connection-per-invocation explodes Postgres connections at 500 tenants; (c) Vercel's egress + function pricing at 5 M client scale costs more than a self-managed Fargate setup.

---

## 2. Compute layer

### Web app (`next start`)

- Build artefact: `npm run build` produces `.next/standalone` + `.next/static`. Ship the standalone folder + node_modules + `.next/static` to the container.
- `Dockerfile`:
  ```dockerfile
  FROM node:22-alpine AS deps
  WORKDIR /app
  COPY package*.json ./
  RUN npm ci --omit=dev

  FROM node:22-alpine AS builder
  WORKDIR /app
  COPY . .
  RUN npm ci && npm run build

  FROM node:22-alpine AS runner
  WORKDIR /app
  ENV NODE_ENV=production
  COPY --from=deps /app/node_modules ./node_modules
  COPY --from=builder /app/.next/standalone ./
  COPY --from=builder /app/.next/static ./.next/static
  COPY --from=builder /app/public ./public
  EXPOSE 3000
  CMD ["node", "server.js"]
  ```
- Resource shape per container: **2 vCPU / 2 GB RAM** is the sweet spot. The `--max-old-space-size=1700` bound prevents OOM under traffic spikes; ECS restarts the task within ~30 s.
- Health check: hit `/api/health` (already built). Container is healthy iff it returns 200 within 3 s.
- Run **2 tasks minimum** behind an ALB. Autoscale rule: target 60 % CPU; min 2, max 20.

### Workers (`tsx src/workers/index.ts`)

Run on **separate ECS service** — never co-located with web. The worker process:
- Drains `events_outbox` (poller)
- Executes `workflow_runs` 
- Materialises segments
- Polls AiSensy template approvals
- Fires the master scheduler

Shape: **1 vCPU / 1 GB RAM** per worker, 2 tasks at launch, scale to 4–6 at 200 tenants. The work is mostly I/O-bound (DB + HTTP); CPU stays low. **`NODE_OPTIONS=--max-old-space-size=900`** keeps each worker contained.

⚠ The worker uses `ALLOW_SYSTEM_TX=1` to do cross-tenant scans. **Never set this on the web service** — it would defeat RLS.

---

## 3. Database (the most important section)

### Provisioning

| Stage | Engine | Instance | Storage | Connections |
|---|---|---|---|---|
| Pilot | RDS Postgres 16 | `db.t3.medium` | 100 GB gp3 | 80 |
| Phase 1 | RDS Postgres 16 Multi-AZ | `db.t3.large` | 250 GB gp3 | 150 |
| Phase 2 | RDS Postgres 16 Multi-AZ + 1 replica | `db.r6g.xlarge` | 500 GB gp3 | 400 |
| Phase 3 | Aurora Postgres 16 + 2 replicas | `db.r6g.2xlarge` writer | autoscaling | 1000+ |

### Critical settings

```sql
-- postgresql.conf overrides via RDS parameter group
shared_buffers = 25% of RAM
effective_cache_size = 75% of RAM
work_mem = 16MB                -- per query op, watch the multiplier
maintenance_work_mem = 256MB
random_page_cost = 1.1         -- gp3 SSD
effective_io_concurrency = 200 -- gp3 supports parallel reads
checkpoint_completion_target = 0.9
wal_buffers = 16MB
default_statistics_target = 100

-- Connection management
max_connections = 200 (Phase 1) | 400 (Phase 2) | 1000 (Phase 3)

-- Logging
log_min_duration_statement = 500ms   # log slow queries
log_lock_waits = on
log_temp_files = 0                   # all temp files
```

### Connection pooling

The code already uses `pg.Pool` (see `src/db/client.ts`). At launch tune **per-container**:
```ts
new Pool({
  max: 20,                      // 20 conns per web container
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 30_000,
})
```

Math: 2 web containers × 20 + 4 workers × 10 = 80 connections. RDS `t3.large` allows 150 — plenty.

**At Phase 2+ put PgBouncer in front of RDS** (transaction-mode pooling). Without it, scaling web horizontally will exhaust connection slots before CPU. Recommended: AWS RDS Proxy (managed PgBouncer) — drop-in, no maintenance, ~$0.015/instance-hour.

### Row-Level Security (RLS)

Already implemented (`drizzle/migrations/0001_rls_policies.sql`). Two things to verify before going live:

1. **Every domain table has a policy.** Run:
   ```sql
   SELECT relname FROM pg_class c
   JOIN pg_namespace n ON c.relnamespace = n.oid
   WHERE n.nspname = 'public' AND relkind = 'r'
     AND relname IN (
       SELECT tablename FROM pg_policies WHERE schemaname = 'public'
     ) = false;
   ```
   Any table that's tenant-scoped but missing a policy = data leak waiting to happen.

2. **Test cross-tenant access.** Create two tenants, log in as Tenant A's owner, hit every API. None of Tenant B's data should ever appear. Automate this as a CI test — it pays for itself the first time someone forgets `withTenant()`.

### Indexes & partitioning

Pre-launch, audit indexes on the four biggest tables:

```sql
-- These should already exist; verify in your DB
CREATE INDEX CONCURRENTLY idx_investors_tenant_status ON investors (tenant_id, status, updated_at DESC);
CREATE INDEX CONCURRENTLY idx_transactions_tenant_date ON transactions (tenant_id, order_date DESC);
CREATE INDEX CONCURRENTLY idx_sips_tenant_status_next ON sips (tenant_id, status, next_installment_at);
CREATE INDEX CONCURRENTLY idx_communications_tenant_created ON communications (tenant_id, created_at DESC);
CREATE INDEX CONCURRENTLY idx_tasks_tenant_assignee_due ON tasks (tenant_id, assignee_id, due_at) WHERE status = 'open';
```

**Partition `transactions` and `communications` once they cross 50 M rows** (probably year 2). Range partitioning by month works well — `pg_partman` automates it.

### Backups

- **Automated daily backups** with 35-day retention (RDS default).
- **Point-in-time recovery (PITR)** enabled — gives you minute-precision restore.
- **Cross-region snapshot copy** to `ap-southeast-1` (Singapore) weekly. SEBI residency is for live data; snapshot copies for DR are acceptable.
- **Test restore quarterly.** Untested backups are theatre — schedule a calendar event every Q1 / Q3.

---

## 4. Redis & queue

- **ElastiCache for Redis 7** in the same VPC.
- `cache.t3.small` (Phase 1) → `cache.r6g.large` (Phase 2) → `cache.r6g.xlarge` cluster mode (Phase 3).
- BullMQ in `src/workers/queues.ts` already creates per-job queues. Watch the rate-limit on **comms queues** specifically — AiSensy rate-limits per business number.
- Set `maxRetriesPerRequest: null` on BullMQ Redis connection so blocking commands don't fail on transient hiccups.

---

## 5. Object storage

- **S3 bucket per environment**: `mfd-growth-prod-docs`, `mfd-growth-staging-docs`.
- **Encryption: SSE-KMS** with a tenant-side managed key. Required by RBI Cybersecurity Framework for regulated entities.
- **Versioning ON.** A deleted KYC doc must be recoverable.
- **Lifecycle policy**: docs older than 365 days → S3 Standard-IA; older than 7 years → Glacier (regulatory retention is 7 years for KYC).
- **Pre-signed URL TTL: 15 minutes max.** The code is already using presigned URLs (`api/compliance/upload-url`); just keep the TTL tight.
- **Block all public access** at the bucket level. Audit quarterly.

---

## 6. External integrations

| Service | Already wired? | Production setup |
|---|---|---|
| AiSensy (WhatsApp) | ✅ | Move to AiSensy paid plan. Each MFD provisions its own WABA → maps via `whatsapp_numbers` table (already built). Webhook URL: `https://app.your-domain.in/api/webhooks/aisensy`. |
| Resend (email) | ✅ | Authenticate sender domain with SPF + DKIM + DMARC. **Per-tenant subdomain** (`mail.<tenant>.your-domain.in`) keeps one MFD's spam complaints from hurting another's deliverability. |
| MSG91 (SMS) | ✅ | DLT-register every template before launch (mandatory in India). The compliance gate already blocks unregistered DLT sends — keep that on. |
| Anthropic (AI) | ✅ | Set `ANTHROPIC_API_KEY` per-environment. Add a per-tenant monthly token cap in code if AI starts costing real money. Claude Sonnet at scale = ~$0.50 per MFD per month for current usage. |
| BSE Star MF | ⏳ deferred | When you wire it, treat the BSE creds as per-MFD secrets in AWS Secrets Manager, never in DB plaintext. |

### Messaging unit costs (Jan 2026 — verify before pricing; + 18% GST + BSP markup)

There are **two cost buckets that behave differently**:

- **Fixed infra** (§1 table) — what *you* pay to host all 500 firms. Small, shared.
- **Variable messaging** — WhatsApp/SMS/email/AI. Scales with send volume and is
  normally **passed through to / paid by each MFD** (every firm runs its own
  AiSensy WABA + DLT SMS sender). You don't eat this unless you bundle it.

| Channel | Unit rate (Jan 2026) | Notes |
|---|---|---|
| WhatsApp **utility** template | **₹0.145 / msg** | Statements, alerts, reminders |
| WhatsApp **marketing** template | **₹0.8631 / msg** | ~10% Meta hike on 1 Jan 2026 |
| WhatsApp **service** (reply in 24h window) | **Free** | |
| AiSensy platform (per WABA, **per MFD**) | **₹999–2,399 / mo** | +₹750/mo per extra agent |
| SMS (MSG91, DLT) | **₹0.15–0.20 / SMS** | DLT templates mandatory |
| Email — AWS SES | **≈ ₹8.5 / 1,000** | Cheapest at scale; code uses Resend, swappable to SES |
| Email — Resend | **~$20 / 50k**, then ~$0.0004/email | Default integration |
| AI — Anthropic | token-based | Haiku classify / Sonnet compose — ~₹200–500/MFD/mo |

**Illustrative per-firm messaging** (10k-client firm, ~3,000 actively messaged/mo:
1 statement email + 2 utility + 0.5 marketing WhatsApp + 1 SMS each) ≈ **₹4,300–6,300 /
firm / month**, dominated by the AiSensy subscription + Meta WhatsApp — and it's
pass-through, not platform margin.

**Unit economics:** infra to serve one firm ≈ **₹190–650/mo** (under ₹100 on the
lean tier). At a **₹3,000/firm/mo × 500 = ₹15 L/mo** subscription vs ~₹1 L infra,
that's **~90%+ gross margin** before support/AI, with messaging metered on top.
Suggested tiers: **Starter ₹1,499 / Growth ₹3,999 / Enterprise custom.**

**Secrets management.** Put every API key in **AWS Secrets Manager** + rotate quarterly. Don't bake them into images. The ECS task definition references the secret ARN; the container reads it at boot.

---

## 7. Security hardening

### Application layer

- ✅ HTTPS everywhere — terminate at ALB, use AWS Certificate Manager (free).
- ✅ JWT cookies are `HttpOnly`, `Secure`, `SameSite=Lax` (verify in `src/lib/auth/session.ts`).
- Add `next.config.ts` security headers:
  ```ts
  headers: async () => [{
    source: "/(.*)",
    headers: [
      { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ],
  }]
  ```
- **WAF in front of ALB.** AWS WAF managed rules: Core Rule Set + Known Bad Inputs + SQL injection + Rate-based (200 req/min/IP). ~₹500/mo.
- **Rate-limit the public form endpoints** (`/api/public/risk-profile/submit`, `/api/public/docs/submit`, `/api/auth/login`) at the application layer too — WAF catches floods, app rate-limit catches credential stuffing.

### Network

- VPC with **public subnets** (ALB only) and **private subnets** (web + workers + RDS + Redis).
- Security groups: ALB→web (443), web→RDS (5432), web→Redis (6379), workers→{RDS, Redis, internet}. Nothing else.
- **No bastion host.** Use AWS Systems Manager Session Manager — IAM-authenticated, fully audited, no SSH key sprawl.

### Compliance audit

- ✅ Audit log table + writer already in place. **Retain 7 years** (SEBI rule).
- ✅ Data Processing Agreement template — sign one per tenant under DPDP Act.
- Run a SAST scan in CI (Semgrep is free + good).
- Annual VAPT (vulnerability assessment + penetration test) — required for RBI-supervised entities. Budget ₹1.5–2.5 L/year.

---

## 8. CI/CD pipeline

GitHub Actions reference flow:

```yaml
name: Deploy
on:
  push:
    branches: [main]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm run test            # add Vitest tests
  build:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: docker/build-push-action@v6
        with:
          push: true
          tags: ECR/mfd-growth:${{ github.sha }}
  migrate:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - run: npm run migrate:all        # hand-numbered SQL runner; run before new containers come up
  deploy:
    needs: migrate
    runs-on: ubuntu-latest
    steps:
      - uses: aws-actions/amazon-ecs-deploy-task-definition@v2
        with:
          task-definition: web-task.json
          service: mfd-growth-web
          cluster: mfd-growth
          wait-for-service-stability: true
```

**Critical rule: migrations run before new containers boot.** Otherwise an old container can crash on a schema it doesn't recognise. Every migration in `drizzle/migrations/` must be **backwards-compatible for one deploy cycle** (additive only — never `DROP COLUMN` in the same deploy that stops writing to it).

---

## 9. Observability

The single biggest cost-saver when something breaks at 3 am.

| Concern | Tool | Cost (Phase 2) |
|---|---|---|
| Error tracking | **Sentry** (free tier covers 5 K errors/mo) | ₹0–5 K/mo |
| APM + traces | **Datadog** or **New Relic** or **Grafana Cloud** | ₹15–30 K/mo |
| Logs | CloudWatch Logs (compress + 30-day retention) | ₹5–10 K/mo |
| DB slow queries | RDS Performance Insights | included |
| Uptime | UptimeRobot / Better Uptime — ping `/api/health` every 60 s | ₹0–2 K/mo |
| Real-user monitoring | Datadog RUM or Vercel Analytics | included with APM |

**Three dashboards to build week-one of production:**

1. **Web latency** — p50 / p95 / p99 per route, error rate, 4xx vs 5xx split.
2. **Worker health** — jobs queued, jobs failed, oldest job age, per-queue throughput.
3. **DB health** — connections in use, slow query top-10, replication lag (if you have replicas), index hit ratio.

**Alerts that page someone:**

- 5xx rate > 1 % for 5 minutes
- p95 latency > 3 s for 10 minutes
- DB connections > 80 % of `max_connections`
- Oldest BullMQ job > 5 min (the comms pipeline is backing up)
- `/api/health` failing for 3 minutes
- AiSensy / Resend / MSG91 webhook delivery failures > 10/hour

---

## 10. Performance benchmarks (do this BEFORE selling)

### Already measured on this codebase (seeded 10,000-client tenant, 100k transactions)

| Path | Result |
|---|---|
| Client-360 valuation (1 client) | **7 ms** |
| Investor list (50 rows + count over 10k) | **12 ms** |
| Firm AUM rollup (SUM over 10k) | **8 ms** |
| Communications timeline (50 + count over 20k) | **11 ms** |
| Nightly `scanTenant` full sweep (cold) | **~7.5 s / tenant** |
| 500-tenant nightly sweep @ `DAILY_OPS_CONCURRENCY=5` | **~12–13 min** |

Per-request latency is bounded by **one firm's** data, not the 5M-investor
platform total, because every query is `tenant_id`-scoped and indexed — adding
the 500th firm does not slow the 1st. (Three scale fixes are in the code:
batched folio revaluation, a `transactions(investor_id)` index that turned the
per-client valuation from a seq-scan into a ~0.1 ms index scan, and the
bounded-concurrency nightly tenant pool.) The k6 plan below is still worth
running on your own staging hardware before launch.

**Automation-freshness probe:** `GET /api/health/workers?token=$HEALTH_TOKEN`
returns 503 if any scheduled job is overdue (>26 h) — wire it to your uptime
monitor alongside `/api/health`. The worker also records a heartbeat per run in
`scheduler_state` and catches up missed runs on boot.

You need numbers to know you can serve 500 MFDs. Run these against a staging environment seeded to mid-scale (50 MFDs × 10 K clients each).

### Load test profile

Tool: **k6** (free, scriptable, runs from a single VM).

| Scenario | Concurrent users | Duration | Acceptance |
|---|---|---|---|
| List 500 clients | 100 | 5 min | p95 < 800 ms |
| Open lead detail | 100 | 5 min | p95 < 1.2 s |
| Submit new lead | 50 | 5 min | p95 < 600 ms |
| Drag-drop in kanban | 50 | 5 min | p95 < 400 ms (blueprint advance) |
| Webhook spike (1000 SR/min) | — | 2 min | 0 dropped events |
| AI assistant query | 20 | 5 min | p95 < 4 s |

If any scenario fails, **don't launch**. Profile (Datadog flamegraphs or Node `--inspect`) and fix the slow path. The most common findings will be:
- Missing index → query plan goes to seq-scan
- N+1 in a list page (loops doing per-row fetches)
- Over-eager `JOIN` pulling all transactions

### Index audit

Before launch, run on the staging DB:

```sql
-- Tables doing seq-scans (= missing indexes)
SELECT schemaname, relname, seq_scan, idx_scan,
       seq_tup_read, n_live_tup
  FROM pg_stat_user_tables
 WHERE seq_scan > idx_scan AND n_live_tup > 10000
 ORDER BY seq_tup_read DESC LIMIT 20;

-- Slow query top-20
SELECT query, calls, mean_exec_time, total_exec_time
  FROM pg_stat_statements
 ORDER BY total_exec_time DESC LIMIT 20;
```

Anything > 100 ms mean-exec on a list page needs an index.

---

## 11. Tenant onboarding playbook

The first 10 tenants will teach you what the next 490 need. Treat this as a workflow, not a sales call.

**Per tenant, week 1 (your team does):**

1. Sales call → contract signed → DPA executed.
2. Internal: create tenant via super-admin (`/super-admin/tenants/new`).
   - Set `licenseStatus = 'trial'` for 14 days.
   - Pick the right package (`Starter` / `Pro` / `Enterprise`) — module gating is already wired.
3. Provision their AiSensy WABA → insert row in `whatsapp_numbers` table.
4. Send the owner an invite (`/api/employees/invite`) — they log in, set password, invite their team.

**Per tenant, week 2 (the MFD does, you guide):**

5. Owner imports existing clients via `/dashboard/investors/import` (Excel wizard — already built).
6. Owner reviews blueprints at Settings → Blueprints, edits the SOP for their firm, activates.
7. RMs log in, see kanban populated.

**Per tenant, week 3:**

8. First WhatsApp template sent via dispatch pipeline → confirms full stack works.
9. Flip `licenseStatus = 'active'` on day 14, first invoice.

**Self-serve eventually**, but for first 50, white-glove every onboarding. The playbook stabilises around tenant #30; after that you can hand it to a junior CSM.

---

## 12. Performance tuning specific to this codebase

Things I'd do before scaling past 50 tenants:

1. **Add Drizzle `prepare()` to hot-path queries.** Every list page query in `app/dashboard/**/page.tsx` can be prepared once and reused — saves 1–3 ms per query × thousands of queries = a lot.

2. **Move the recipe registry to lazy import.** `src/lib/recipes/index.ts` currently imports all 25 recipes at boot. Switch to dynamic import keyed by recipe key — cuts cold-start by ~400 ms per worker.

3. **Add cursor pagination to communications + transactions list APIs.** OFFSET pagination on a 5 M-row table is murder. Already using LIMIT 50 in the SQL — add `WHERE created_at < $cursor` so the planner can seek.

4. **Materialise tenant-level KPIs.** The Owner Cockpit recomputes net sales / AUM / SIPs on every load. At 500 K clients per tenant that's a 200 ms aggregate. Build a `tenant_kpi_snapshots` table the worker refreshes every 5 min — page reads from there, < 5 ms.

5. **Disable RLS for trusted internal queries.** Workers using `withSystem()` already bypass RLS. Verify the outbox poller, segment materializer, and master scheduler are all using it — they shouldn't be paying the RLS overhead.

6. **Tune the dev-server wrapper's heap for prod.** `npm run start` doesn't have HMR creep but a misbehaving query can still balloon heap. Set `NODE_OPTIONS=--max-old-space-size=1700` on the ECS task — leaves headroom in the 2 GB container.

---

## 13. Scaling milestones — when to do what

| Trigger | Action |
|---|---|
| **5 tenants on prod** | Verify backups restore. Run first load test. |
| **10 tenants** | Set up Sentry, log alerts. |
| **25 tenants** | Set up Datadog/Grafana APM. Add a CDN (CloudFront) for `/_next/static`. |
| **50 tenants** | Add 1 RDS read replica. Move list-page queries to it. Add PgBouncer. |
| **100 tenants** | Move to ECS Fargate (auto-scaling). Add 2nd worker service. |
| **200 tenants** | Migrate RDS → Aurora Postgres. Partition `transactions` + `communications` by month. |
| **300 tenants** | Add a 2nd read replica. Move comms log + audit log to a separate database (lighter writer). |
| **500 tenants** | Aurora cluster scale-up. Multi-region read replica for DR. Dedicated DBA on retainer. |

---

## 14. Disaster recovery

What happens if AWS Mumbai has an AZ outage at 11 am on a Tuesday?

| Failure | Recovery time (RTO) | Data loss (RPO) | Pre-built |
|---|---|---|---|
| One ECS task crashes | 30 s | 0 | ✅ ALB removes from pool |
| Entire ECS service crashes | 2 min | 0 | ✅ Service auto-scales replacement tasks |
| Single AZ outage | 5 min | 0 | ✅ Multi-AZ RDS + workers across AZs |
| Full region outage (rare) | 60 min | < 1 hr | ⏳ Need cross-region snapshot + DNS failover playbook |
| Data corruption (bad migration) | 30 min | up to last PITR point | ✅ RDS PITR + the migration safety rule in §8 |
| Ransomware / accidental drop | 1 hr | up to backup interval | ✅ Versioned S3 + 35-day RDS backups |

**Write the runbook.** A markdown file in `/ops/runbooks/` per failure mode: "What just happened, what to do, who to call, how to verify." The first hour of an outage is not when you want to be figuring it out from first principles.

---

## 15. The 30-day pre-launch checklist

Copy this into a project tracker; nothing ships to prod with any item unticked.

### Infrastructure (week 1)
- [ ] AWS account, billing alerts, MFA on root + IAM users
- [ ] VPC + public/private subnets across 2 AZs
- [ ] ALB + ACM cert for `app.your-domain.in`
- [ ] RDS Postgres 16, Multi-AZ, Multi-AZ backup
- [ ] ElastiCache Redis 7
- [ ] S3 bucket with KMS + versioning + lifecycle
- [ ] Secrets Manager populated with all API keys
- [ ] ECR repo, first image built

### Application (week 2)
- [ ] `npm run start:prod` boots cleanly with prod-shaped env
- [ ] DB migrations applied
- [ ] Seed admin tenant (SSIT super-admin)
- [ ] Health check returns 200
- [ ] One end-to-end test passes: signup → invite → import 100 clients → send WA → see in comms log

### Security (week 3)
- [ ] WAF rules active
- [ ] CSP / HSTS / X-Frame-Options headers
- [ ] RLS coverage test passes (cross-tenant data invisible)
- [ ] DPA template ready
- [ ] Audit log writes verified for every mutation
- [ ] VAPT booked for week 6

### Observability (week 3)
- [ ] Sentry hooked up, source maps uploaded
- [ ] Datadog (or equivalent) collecting from web + workers + RDS
- [ ] 3 dashboards built
- [ ] 6 alerts firing to PagerDuty / Slack
- [ ] Uptime monitor on `/api/health`

### Load test (week 4)
- [ ] k6 scripts written for the 6 scenarios in §10
- [ ] All p95 budgets met
- [ ] Index audit clean
- [ ] Slow-query log under 100 ms mean for all top-20

### Launch (week 4)
- [ ] First MFD's tenant provisioned
- [ ] Owner invite sent
- [ ] On-call rotation established (you + one engineer for first 30 days)
- [ ] Runbook + status page live
- [ ] Champagne (mandatory)

---

## TL;DR

**Don't try to deploy for 500 MFDs from day one.** Stand up the Phase-1 stack (~₹50–80 K/mo), get to 50 paying MFDs, then graduate to Phase 2. The codebase is ready for scale — RLS, withTenant, BullMQ workers, comms pipeline, audit log are all in place. The infrastructure is what you're buying with each scaling phase.

**Hire one SRE-flavoured engineer before tenant #50.** You can't sell, build features, and run prod ops simultaneously past that point. Budget ₹18–25 L/year for someone who can own §3 and §9.

**Track three numbers obsessively:**
- p95 latency on list pages (target < 800 ms)
- Failed dispatches per million sends (target < 100 ppm)
- Cost per active tenant per month (target < ₹300 in Phase 2, < ₹150 in Phase 3 thanks to amortisation)

When all three stay green, you can sell to 500 MFDs with confidence.
