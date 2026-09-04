# Narrow deploy — mobile API additions only

Ships **only** the 6 files below. Deliberately excludes the other in-progress work
sitting in the tree (knowledge base, expected inflows, RTA inbound mail,
super-admin landing packages), which a broad tarball would have swept into
production half-finished.

## What ships

| File | Why |
|---|---|
| `src/app/api/client-forms/send/route.ts` | **NEW** — "Send a form" (risk profile / KYC docs / health check / portfolio link) |
| `src/lib/client-forms/templates.ts` | **NEW** — auto-provisions the WhatsApp templates those sends need |
| `src/app/api/leads/[id]/dispatch/route.ts` | **NEW** — template sends to a lead (previously investor-only) |
| `src/app/api/investors/[id]/dispatch/route.ts` | FIX — returned `500` for caller mistakes; now 400/404 |
| `src/app/api/health/route.ts` | Reports the deployed build |
| `next.config.ts` | Bakes the build stamp in |

All nine libraries these import are already committed and live — verified, so
nothing else is required.

**No migrations.** Nothing here touches the schema. Do **not** let the untracked
migrations `0185`–`0194` ride along; they belong to other workstreams.

## 1. Ship the files

From the repo root on your laptop:

```bash
tar -czf - src/app/api/client-forms src/lib/client-forms "src/app/api/leads/[id]/dispatch" "src/app/api/investors/[id]/dispatch/route.ts" src/app/api/health/route.ts next.config.ts | ssh -i ~/.ssh/ssit-crm-deploy ec2-user@13.204.242.178 'cd ~/app && tar -xzf -'
```

## 2. Build + restart

```bash
ssh -i ~/.ssh/ssit-crm-deploy ec2-user@13.204.242.178 'bash ~/run-deploy.sh'
```

Prune first if the box is tight on space — check `deploy-ram-and-prune` notes.

## 3. Confirm it landed

```bash
curl -s https://crm.equitywala.com/api/health
```

`builtAt` should show the time you just deployed (prod has no `.git`, so `build`
will be `null` — that's the intended fallback). A fresh `uptimeSec` in single
digits also confirms the container restarted.

## 4. Smoke-test the new routes

Log in on the phone (or with a real session) and check:

- **Client → ⋮ → Send a form** → pick *Risk profile*. Expect a `/r/<token>` link
  and an honest per-channel result. WhatsApp may report *skipped* until a
  template is approved — the `wa.me` fallback covers it, and the template is
  submitted automatically on that first send.
- **Lead → ⋮ → Quick comms** → the template picker should load (empty list is
  fine if no approved templates exist yet).
- A deliberately wrong template key should now return **404 with a readable
  message**, not `500 internal`.

## Rollback

Nothing is destructive and no schema changed. To revert, restore the three
previously-existing files from git and re-run `run-deploy.sh`; the two new
routes simply become unreachable again:

```bash
git checkout -- "src/app/api/investors/[id]/dispatch/route.ts" src/app/api/health/route.ts next.config.ts
```
