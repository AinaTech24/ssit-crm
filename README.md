# MFD Practice Platform

The practice operating system for Indian Mutual Fund Distributors — multi-tenant SaaS for ARN-holding firms with 2–50 employees.

This repository implements the design in `../MFD_Platform_Design_Blueprint.md`, with the **Automation & Messaging Engine (§6)** as the central nervous system: workflow rules, filter/segment AST, criteria-based actions, WhatsApp (AiSensy), email (Resend), SMS (MSG91), all gated by a non-bypassable compliance pipeline.

## What's in here today

| Layer | Status | Where |
|---|---|---|
| Multi-tenant Postgres domain schema (100+ tenant-aware tables) | ✅ | [src/db/schema/](src/db/schema/) |
| Postgres Row-Level Security | ✅ | [drizzle/migrations/0001_rls_policies.sql](drizzle/migrations/0001_rls_policies.sql) |
| Filter/Segment AST + SQL compiler + JS predicate | ✅ | [src/lib/filter/](src/lib/filter/) |
| Workflow engine (DAG, versioning, retries, pause/resume) | ✅ | [src/lib/workflow/](src/lib/workflow/) |
| 17 action handlers (WA / email / SMS / task / branch / loop / wait / AI compose / …) | ✅ | [src/lib/workflow/actions/](src/lib/workflow/actions/) |
| Unified comms pipeline with consent + compliance gate | ✅ | [src/lib/comms/pipeline.ts](src/lib/comms/pipeline.ts) |
| 11 compliance checkers (AMFI, SEBI May 2026, DPDP, DLT, WA session) | ✅ | [src/lib/comms/compliance.ts](src/lib/comms/compliance.ts) |
| Channel adapters: Vartify WhatsApp, Resend, MSG91 | ✅ | [src/lib/comms/adapters/](src/lib/comms/adapters/) |
| Email template renderer (React Email + auto-footer) | ✅ | [src/lib/comms/email_renderer.tsx](src/lib/comms/email_renderer.tsx) |
| Worker process (outbox, runner, scheduler, segment materializer, WA template sync) | ✅ | [src/workers/](src/workers/) |
| 24 pre-built MFD automation recipes | ✅ | [src/lib/recipes/](src/lib/recipes/) |
| Next.js dashboard (workflows, segments, templates, comms, compliance, investors, tasks) | ✅ | [src/app/dashboard/](src/app/dashboard/) |
| Webhook routes: AiSensy + Resend | ✅ | [src/app/api/webhooks/](src/app/api/webhooks/) |
| Signed web/mobile sessions, device revocation and TOTP 2FA | ✅ | [src/lib/auth/](src/lib/auth/) |
| BSE Star MF adapter | ✅ live-capable | credentials required; demo mode fails closed in production |
| NSE NMF II adapter | ⏳ unavailable | do not promise NSE execution yet |
| CAMS / KFintech mailback, parsing, import and reconciliation | ✅ | [src/lib/rta/](src/lib/rta/) |
| Field-team mobile app (Expo / React Native) | ✅ | [mobile/](mobile/) |
| Expiring investor portal links | ✅ | [src/app/portal/](src/app/portal/) |
| Product readiness and production stub guard | ✅ | [src/app/dashboard/settings/readiness/](src/app/dashboard/settings/readiness/) |
| Video session suite | ⏳ deferred | Phase 2 |
| AI assistant Tier 2 RAG | ⏳ deferred | Phase 3 |

## Architecture in one paragraph

A modular monolith on **Next.js 15 + TypeScript + Postgres + Redis + BullMQ**. Tenant isolation is enforced at the database via **Row-Level Security** — every query carries `app.tenant_id` set by middleware, and RLS policies reject cross-tenant access even if app code has a bug. The web app handles UI + short request/response work; a separate **worker process** (`npm run worker`) runs the outbox poller, workflow runner, segment materializer, master scheduler, and AiSensy template sync. Every domain mutation writes to an outbox table in the same transaction; the poller fans events out to subscribed workflows. Workflows are DAGs of typed nodes (trigger / send_* / create_task / branch / delay / wait_for_event / loop / end), versioned and replayable. Every outbound send passes through the **compliance pipeline** before dispatch — no exceptions.

See [AGENTS.md](AGENTS.md) for the developer-facing deep dive.

## Quick start

### Prerequisites
- **Node.js 20+** and npm 10+
- **PostgreSQL 16** (locally or hosted — Supabase / Neon work)
- **Redis 7** (locally or hosted — Upstash works)

### Install + run

```bash
# 1. Install dependencies
npm install

# 2. Copy env template and fill in your keys
cp .env.example .env
#   - DATABASE_URL          (Postgres connection string)
#   - REDIS_URL             (Redis connection string)
#   - NEXTAUTH_SECRET       (any random 32-byte string)
#   - VARTIFY_API_TOKEN     (platform WhatsApp fallback; tenants can self-connect)
#   - RESEND_API_KEY        (your Resend account)
#   - GEMINI_API_KEY or ANTHROPIC_API_KEY (AI features)

# 3. Push schema and run RLS migration
npm run db:push
psql $DATABASE_URL -f drizzle/migrations/0001_rls_policies.sql

# 4. Seed the 24 pre-built recipes
npm run seed

# 5. Start the web app
npm run dev                  # → http://localhost:3000

# 6. In a second terminal: start the worker process
npm run worker
```

The dashboard is at `/dashboard` — workflows, segments, templates, communications, compliance.

For an investor presentation, seed the demo tenant and follow [docs/investor-demo-runbook.md](docs/investor-demo-runbook.md). Before any commercial launch, `/dashboard/settings/readiness` must show no critical blockers.

### Worker process

The worker is a separate Node process that runs:
- **Outbox poller** — reads `events_outbox` and fans events to workflow triggers + parked wait_for_event runs
- **Workflow runner** — executes queued workflow steps
- **Segment materializer** — refreshes dynamic segments on schedule
- **Master scheduler** — fires `schedule`-kind triggers (cron expressions in Asia/Kolkata)
- **AiSensy template sync** — polls AiSensy every 15 min for Meta approval status

You can split groups across processes via the `WORKER_GROUPS` env var:
```bash
WORKER_GROUPS=outbox,wf      npm run worker   # process A
WORKER_GROUPS=seg,sched,wa_sync npm run worker # process B
```

## Configuration knobs (env)

See `.env.example`. The important ones beyond credentials:
- `WORKFLOW_RUNNER_CONCURRENCY` (default 10) — parallel step executions per worker
- `OUTBOX_POLLER_INTERVAL_MS` (default 200) — how aggressively to drain the outbox
- `SEGMENT_MATERIALIZER_INTERVAL_MS` (default 60_000)
- `MASTER_SCHEDULER_INTERVAL_MS` (default 30_000)

## Pre-built automation recipes

Ship with 24 recipes inspired by real MFD pain points:

1. SIP rejection follow-up (smart branching by reason code)
2. Mandate expiry T-90 / T-60 / T-30 reminders
3. NISM expiry alert (T-90/60/30/7) + EUIN disable on expiry
4. ARN expiry alert (T-120/90/60/30)
5. Market volatility broadcast (NIFTY −2% → stay-invested message)
6. HNI quarterly review cadence (90d) + 14d escalation
7. Retail half-yearly review (180d)
8. Redemption retention play (>₹5L → urgent RM task + investor outreach)
9. Birthday touchpoint
10. Anniversary touchpoint
11. KYC expiry / re-KYC (14d follow-up + escalation)
12. Nominee missing (AUM >₹1L)
13. Bank update verification
14. Document chase (10 daily reminders → branch escalation)
15. Inactive investor reactivation drip (D0/D3/D10)
16. Goal review reminder
17. Lead nurture drip (D0/D2/D5/D14/D30)
18. Employee onboarding checklist
19. Employee offboarding (revoke access + reassign)
20. Daily MIS digest to owner (AI-composed)
21. Weekly RM scorecard
22. Complaint SLA breach escalation
23. Minor → major transition (on 18th birthday)
24. Mandate failure smart retry (branched by sub-reason)

Browse them at `/dashboard/workflows/recipes`.

## Compliance baked in

Every outbound message passes through 11 deterministic checks before dispatch:
1. AMFI mandatory risk disclaimer (marketing)
2. SEBI May 2026 ARN + registered-name disclosure
3. No guaranteed-returns language (incl. "assured", "fixed return", "X% guaranteed")
4. No scheme-specific marketing without AMC approval (AMFI clause 4(k))
5. No "Wealth Adviser" terminology unless RIA-registered
6. SMS: DLT template id required (TRAI)
7. WhatsApp marketing: requires session window OR pre-opt-in
8. Consent check (channel × scope)
9. Compliance score floor (configurable per template category)
10. Audit trail with content hash for every send (DDQ-pack ready)
11. AI deep-check (optional, Professional+ tier) — Claude reviews against AMFI Code of Conduct

Any `block` finding stops the send. The finding + score are snapshotted into the `communications` row, immutable forever.

## Deployment

Production-ready posture:
- **App:** Vercel (Edge for marketing site, Node for routes)
- **Worker:** Railway, Fly.io, or any Node host that allows long-running processes (NOT Vercel — its execution time limit kills long workers)
- **DB:** AWS RDS or Neon, **ap-south-1 (Mumbai)** — DPDP localization
- **Redis:** Upstash (Mumbai) or AWS ElastiCache
- **Observability:** Sentry + Datadog

## What this is NOT (yet)

- Not connected to BSE Star MF / NSE NMF II — that's Phase 1
- No CAMS/KFintech reverse feed parser yet
- Auth is scaffolded with NextAuth dependencies but not fully wired
- No real billing — Razorpay integration TBD

These are the next chapters. The spine is done; everything else plugs into it.

## License

Proprietary. See LICENSE.
