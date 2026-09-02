# Master Prompt — RTA Import for a SINGLE-TENANT CRM on a Hostinger VPS

> Companion to `RTA-IMPORT-MASTER-PROMPT.md`. That one describes the full
> multi-tenant, S3-backed design. **This one is the adaptation for one firm on a
> VPS** — three things change materially: storage, tenancy, and memory.
>
> Still true: **copy the parsers, don't regenerate them.** See the warning
> section at the top of the companion doc. Column maps for CAMS R9 and KFintech
> MFSD211 are empirical (~1,200 lines) and a spec cannot reproduce them.

---

You are wiring the **RTA reverse-feed import** into a CRM that:
- serves **exactly one MFD firm** (one tenant), and
- runs on a **Hostinger VPS** (no AWS S3, modest RAM, likely Nginx in front).

Follow this exactly. The four sections marked **⚠** are where a VPS deployment
breaks; they are not optional.

## 1. What to copy from the source repo

```
src/lib/rta/**                       all 18 files — especially cams.ts,
                                     kfintech.ts, parsers.ts (the column maps)
src/workers/rta-import-worker.ts
src/workers/rta-inbox-poller.ts      only if you want email auto-import
src/db/schema/rta_imports.ts
src/db/schema/rta_inbound_messages.ts
src/app/api/rta/**                   import, import-async, import-status, import-url
src/app/api/rta-imports/**           route, upload, upload-url, bulk, [id]
src/app/api/upload-local/[...key]/route.ts     ⚠ REQUIRED on a VPS — see §3
src/app/dashboard/rta-imports/**
src/app/dashboard/imports/rta/**
```

Supporting modules they import: `@/db/client`, `@/db/schema`,
`@/lib/storage/s3` (keep the file — it contains the local fallback),
`@/lib/crypto`, `@/lib/comms/imap`, `@/lib/observability/capture`.

npm: `@zip.js/zip.js`, `xlsx`, `bullmq`, `ioredis`, `drizzle-orm`.

`rta_forward_addresses` is **not needed** — see §2.

## 2. Single tenant — what to simplify

**Recommendation: keep the `tenant_id` column, drop the routing.**

Do **not** strip `tenant_id` out of the schema and code. It touches hundreds of
call sites, and every `withTenant()` wrapper would need rewriting. Instead:

```ts
// lib/tenant.ts
export const TENANT_ID = process.env.TENANT_ID!;   // one fixed UUID, seeded once
```

- Keep `tenant_id` on `rta_file_imports` and `rta_inbound_messages`; always
  write `TENANT_ID`.
- Keep RLS if it already exists — it costs nothing and stays correct.
- **Drop `rta_forward_addresses` entirely.** Its only job is "which tenant does
  this inbound email belong to". With one firm there is nothing to resolve: the
  mailbox *is* theirs.
- The poller becomes: poll the firm's own mailbox → classify attachments →
  store → enqueue. No recipient lookup, no per-tenant token addresses, no
  unmatched-mail state.
- ZIP passwords move from per-tenant config to app settings (still **encrypted at
  rest** — a CAMS/KFintech password protects the firm's whole client book).

This keeps you able to re-enable multi-tenancy later without a migration.

## 3. ⚠ Storage — no S3 on a VPS

The multi-tenant design uploads **directly to S3 via a presigned URL**,
specifically so large files never pass through the app server. On a VPS you have
no S3, so the file **must** go through Node — which is exactly the path that
truncated RTA zips. Three rules make it safe:

**3.1 Turn on local storage.** In `.env`:

```
ALLOW_LOCAL_STORAGE=1
UPLOAD_DIR=/var/lib/crm/uploads
TENANT_ID=<the one tenant uuid>
```

With no S3 keys set, `presignedPutUrl()` returns `/api/upload-local/<key>` and
`presignedGetUrl()` reads from disk. The rest of the pipeline is unchanged — it
only ever sees a storage *key*.

**3.2 ⚠ Stream the body to disk. Never `req.arrayBuffer()`.**
This is the single most important line in this document. `arrayBuffer()`
truncates files over roughly 10 MB, and the symptom appears three stages later
as `End of central directory not found` from the unzip step — which reads like a
corrupt zip, not a truncated upload. Copy `upload-local/[...key]/route.ts`
verbatim; it already streams:

```ts
const reader = (req.body as ReadableStream<Uint8Array>).getReader();
for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  if (!ws.write(value)) await new Promise((r) => ws.once("drain", r));
}
```

It also enforces a 30 MB cap and `export const maxDuration = 120`.

**3.3 ⚠ Raise the reverse-proxy body limit.**
Hostinger VPS deployments usually sit behind Nginx, whose default
`client_max_body_size` is **1 MB**. Every real RTA zip is larger. Nginx rejects
it with **413** before Node ever sees the request:

```nginx
server {
  client_max_body_size 50m;
  proxy_read_timeout   180s;   # a big master parse can hold the request open
}
```

If you use Caddy instead, there is no default cap — but still raise the read
timeout.

**3.4 Persist and back up the uploads directory.**
If the app runs in Docker, `UPLOAD_DIR` must be a **named volume or bind mount**,
or every redeploy silently deletes the import history's files. The DB rows would
survive while the files vanish — a confusing failure. Include this path in
whatever backup you run for Postgres.

## 4. ⚠ Memory — the constraint that actually bites on a VPS

Parsing a CAMS R9 / KFintech MFSD master (a ~10 MB zip expanding to a very large
sheet) is CPU- and memory-heavy. Done inside the web request it OOMs or
event-loop-blocks the server and 503s the whole site.

- **Run it in the worker process**, never in the route. The route records the
  `rta_file_imports` row, enqueues, and returns a job id; the client polls
  `/api/rta/import-status?jobId=…`.
- **Worker concurrency = 1.** One heavy parse at a time. On a 2–4 GB VPS, two
  concurrent master parses will OOM.
- **Bound the heap** so V8 fails cleanly instead of the OS thrashing:
  `node --max-old-space-size=1536 worker.js` on a 2 GB box.
- **Add swap** (2–4 GB). It converts a hard OOM kill into slow-but-alive.
- Run web and worker as **separate processes** (pm2, systemd, or two containers)
  so a worker OOM cannot take the site down.

## 5. Queue

You still need **Redis** for BullMQ. On the VPS:

```bash
docker run -d --name redis --restart unless-stopped -p 127.0.0.1:6379:6379 redis:7-alpine
```

Bind to **127.0.0.1**, not `0.0.0.0` — an internet-exposed Redis with no password
is compromised within hours. Then `REDIS_URL=redis://127.0.0.1:6379`.

> If you genuinely cannot run Redis, the fallback is a DB-polled job table: the
> route inserts a `pending` row, a `setInterval` loop in the worker picks up one
> at a time. Slower and less observable, but it preserves the invariant that
> matters — parsing never happens in the web request.

## 6. Email auto-import (optional, but this is what makes it hands-off)

Hostinger provides mailboxes, so create one (e.g. `rta@yourfirm.com`) and have
the firm auto-forward RTA mail to it.

Simplified for one tenant:

```
poll IMAP  →  for each new message
              ├─ classify each attachment by report code + sender
              │    R9 → CAMS master;  MFSD211/203 → KFintech master
              │    no match → quarantine + log (NEVER guess)
              ├─ if no attachment, look for a DOWNLOAD LINK in the body   ⚠
              ├─ write the file to UPLOAD_DIR
              └─ enqueue the SAME rta.import job the manual upload uses
```

- **⚠ Handle the link case.** Both registrars switch to a download link once the
  report exceeds a size threshold — CAMS puts a `DownloadURL` ending `.zip` in
  the body, KFintech hides it behind a "Click Here" anchor. Assume attachments
  only and **you silently miss exactly the largest files**, which is worse than
  failing loudly.
- **The poller must contain zero parsing logic.** It is an email→file→queue
  bridge. Two parsers drift; one does not.
- Log **every** message seen, including rejects, into `rta_inbound_messages`.
  Without it, "the import didn't run" is undebuggable.
- Store the IMAP password **encrypted at rest**, decrypted only in-process.

## 7. Import rules — unchanged, and still the highest-risk part

Single-tenancy changes nothing here. Restating because it is the costliest thing
to get wrong:

- **Investors upsert by PAN.** The feed fills contact / KYC / address / bank /
  nominee fields.
- **Never clobber CRM-owned fields**: `rm_id`, tags, risk profile, AUM, service
  tier, status, notes, client category.
- **Blank feed value never overwrites existing data.** RTA files routinely ship
  empty cells; treating blank as "clear this" wipes good data.
- **Folios are feed-owned** — amc / rta / schemes / investor link are overwritten.
- **No PAN → skip and count.** Never invent a placeholder investor.
- **Idempotent** — re-importing the same file updates in place.
- **Dedupe by sha256 checksum**, not filename. The same report gets re-forwarded,
  often renamed.
- Ship **`dryRun: true`** (read-only counts) and put it behind the upload button
  as a preview. This is what makes the first real import safe.

## 8. Deployment checklist

```
[ ] TENANT_ID seeded and set in .env
[ ] ALLOW_LOCAL_STORAGE=1, UPLOAD_DIR set and on a PERSISTENT volume
[ ] Nginx client_max_body_size 50m + proxy_read_timeout 180s
[ ] Redis bound to 127.0.0.1, REDIS_URL set
[ ] Worker as its own process, concurrency 1, --max-old-space-size set
[ ] 2–4 GB swap enabled
[ ] Migrations applied for rta_file_imports + rta_inbound_messages
[ ] ZIP passwords stored encrypted, not in the import row
[ ] UPLOAD_DIR included in backups alongside Postgres
```

## 9. Acceptance tests (run on the VPS, not locally)

1. Upload a **real 10 MB+ AES zip** → completes, no `End of central directory`.
   *(Passes locally and fails on the VPS ⇒ Nginx body limit — §3.3.)*
2. Same file twice → second is `rejected` as duplicate.
3. Master import twice → identical counts, zero new investors the second time.
4. Feed row with blank email/phone → existing values survive.
5. Feed row for an existing investor → `rm_id`, tags, risk profile unchanged.
6. Row with no PAN → skipped and counted.
7. During a master parse, load the dashboard in another tab → **stays responsive**.
   *(If it hangs, parsing is still in the web request — §4.)*
8. `.xls` that is actually HTML → parses.
9. Mail with a download link and no attachment → still imports.
10. Redeploy the container → previously imported files still readable.
    *(If not, `UPLOAD_DIR` isn't persistent — §3.4.)*

## 10. Order of work

1. Copy the files (§1) + migrations. Nothing user-visible yet.
2. `.env` + Nginx + Redis + worker process (§3, §4, §5). Prove the queue round-trips.
3. Manual upload → local disk → worker → decode → **one** parser end-to-end.
4. `import.ts` with **dryRun first**. Ship the preview before any write path.
5. Remaining file kinds via `process.ts` + `external_ref` idempotency.
6. Email auto-import (§6) last — it is an optimisation on a working pipeline.

Steps 1–4 already give the firm a working manual importer with a safe preview.
