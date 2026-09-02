# Deploying MFD Growth OS to AWS — cheap now, scale later

**Goal:** launch for ~50 MFDs at the lowest sensible cost, then scale by upgrading
pieces (not rewriting anything) as you grow. Everything runs in Docker, so the
upgrade is "move the same image to bigger infra."

Region: **ap-south-1 (Mumbai)**.

```
   your domain (Route 53 / Cloudflare)
        │  A record → Elastic IP
        ▼
   ┌─────────────────────────── 1 × EC2 (t4g.medium) ───────────────────────────┐
   │  Caddy (:443, free auto-HTTPS) → web (next start :3000, /api/health)        │
   │                                  worker (tsx workers/index.ts)              │
   │                                  redis (BullMQ queues, on-box)              │
   └──────────────────────────────────────┬─────────────────────────────────────┘
                                           │
                              RDS PostgreSQL (db.t4g.micro)         S3 (uploads)
                              — durable, automated backups          (+ optional CDN later)
```

No paid load balancer (Caddy does TLS), no ECS, no ElastiCache. ~**₹3–4k/mo**.

---

## Cost tiers (pick one)

| Tier | What | Approx ₹/mo | When |
|---|---|---|---|
| **0 — rock bottom** | 1 EC2, **Postgres on the box** (`--profile db-onbox`) + nightly `pg_dump`→S3 | **₹2–3k** | tightest budget, you accept managing DB backups |
| **1 — cheap + safe (recommended)** | 1 EC2 (web+worker+redis+caddy) + **managed RDS micro** | **₹3–4k** | real customers; managed backups & point-in-time restore |
| **2 — scale (later)** | ECS Fargate (web+worker) + ALB + ElastiCache + RDS Multi-AZ | ₹10–15k+ | when one box / one DB isn't enough |

I recommend **Tier 1**: the DB holds customers' financial + compliance data, so
managed RDS (backups, restore, encryption) is worth the extra ~₹1k. The compose
file supports Tier 0 too if you'd rather start there.

---

## ✅ What I need from you

### 1. AWS access (one-time)
- AWS account + an IAM user (`AdministratorAccess` for bring-up; we tighten later).
- On this machine:
  ```powershell
  winget install Amazon.AWSCLI Hashicorp.Terraform
  aws configure          # access key + secret, region = ap-south-1
  ```
  (Docker only needs to be installed **on the EC2 box**, not here — the image is
  built on the server. I'll handle that over SSH.)

### 2. Your domain
- The subdomain to launch on, e.g. **`app.yourfirm.com`**.
- Where its DNS lives (Route 53 / GoDaddy / Cloudflare) — you'll add **one A record**
  pointing to the EC2 Elastic IP I give you. Caddy issues + renews the TLS cert
  automatically (free). No ACM needed on this path.

### 3. Keys (into the box's `.env.production`, kept off the repo)
- To launch: **`ANTHROPIC_API_KEY`** + **`RESEND_API_KEY`** (with a verified from-domain).
- Later: AiSensy (WhatsApp), MSG91 (SMS), Razorpay, KYC. Full list: `.env.production.example`.

### 4. Demo or real users?
- **Demo/pilot** → I seed the demo tenant + recipes.
- **Real users** → I skip the seed and we create your first real owner account.

**Fastest unblock:** do **#1** (`aws configure`) and tell me the **domain** (#2).

---

## Deploy flow (what I'll run once #1–#2 are ready)

1. **Terraform** a small stack: 1 EC2 (t4g.medium) + Elastic IP + security group
   (443/80 open, SSH locked to you), RDS db.t4g.micro (private), an S3 uploads
   bucket + IAM. (Tear-down-able; this is also the seed for the Tier-2 upgrade.)
2. **SSH in**, install Docker, pull the repo, drop in `.env.production`.
3. `docker compose -f docker-compose.prod.yml build`
4. **Create schema, RLS role + migrations** as one-off — order matters on a fresh DB:
   - `... run --rm web npm run db:push` — creates all tables from the Drizzle schema. **REQUIRED first on a fresh RDS**; the numbered SQL migrations only ALTER existing tables (e.g. `0001_rls_policies.sql` enables RLS on tables that must already exist), so running `migrate:all` against an empty DB would fail.
   - `... run --rm web npm run db:provision-app-role`
   - `... run --rm web npm run migrate:all`
5. (Demo) `... run --rm web npm run seed`; (real) create the first owner.
6. `docker compose -f docker-compose.prod.yml up -d` → Caddy gets the cert, site is live.
7. Smoke-test `/api/health`, `/api/health/workers`, a test email/WhatsApp send.

## Redeploying after a code change

**A push to GitHub does not deploy by itself** — the EC2 box must rebuild + restart.
(If "changes aren't reflecting" on the live site, this is almost always why.)

**Option A — automatic (recommended).** Add these repo secrets (GitHub →
Settings → Secrets and variables → Actions). Then **every push to `deploy/aws`**
SSHes into the box and redeploys via `.github/workflows/deploy.yml`:

| Secret | Value |
|---|---|
| `DEPLOY_SSH_HOST` | EC2 public IP / DNS |
| `DEPLOY_SSH_USER` | ssh user, e.g. `ubuntu` |
| `DEPLOY_SSH_KEY` | the **private** key (PEM) for that user — paste the whole file |
| `DEPLOY_SSH_PORT` | *(optional)* defaults to 22 |
| `DEPLOY_APP_DIR` | *(optional)* repo path on the box, defaults to `/home/ubuntu/MYCRM` |

Until those secrets exist the workflow runs but skips the SSH step (the push still
succeeds), so it never blocks a commit.

**Option B — manual, one command on the box:**
```bash
cd ~/MYCRM                 # the repo path on the EC2 box
bash scripts/redeploy.sh   # pull → rebuild → migrate → restart → health-check
```

**DB migrations now run automatically on every deploy** — the compose `migrate`
one-shot service applies pending migrations before web/worker start, so you never
have to remember `migrate:all` again. (A brand-new DB still needs the one-time
`db:push` + `db:provision-app-role` from the first-run steps above.)

## Files already in the repo for this
- `Dockerfile` — one image, runs web or worker by command.
- `docker-compose.prod.yml` — web + worker + redis + caddy (+ optional on-box postgres).
- `Caddyfile` — reverse proxy + automatic HTTPS.
- `.env.production.example` — every env var, grouped + marked required/optional.

## Hardening (built in)
- `ALLOW_SUPERUSER_DB=0` → app runs as the non-superuser RLS role (live tenant isolation).
- RDS private (no public IP); SSH restricted to your IP; security headers via Caddy.
- Secrets only in `.env.production` on the box (chmod 600), never in the repo.
- Nightly DB backup: RDS automated (Tier 1) or `pg_dump → S3` cron (Tier 0).
- `restart: unless-stopped` on every container; container healthcheck on `/api/health`.

## Upgrade path (no rewrite)
When growth demands it: (a) bump the EC2 size first (vertical, 2 min); then
(b) move web+worker to **ECS Fargate + ALB** using the *same* image, (c) Redis →
**ElastiCache**, (d) RDS → **Multi-AZ + read replica**. The Terraform is structured
so each is an incremental change.
