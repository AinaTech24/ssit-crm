# RTA Mailback — bringing a cloned CRM up to the current implementation

> **How this was derived.** I audited the RTA subsystem in *this* repo
> (`feat/rta-mailback-forwarding`, working tree including uncommitted changes) and
> compared it against the walkthrough you pasted. That walkthrough is an **older
> snapshot** — it names `src/lib/rta/link-fetch.ts` and migration `0191`, neither
> of which exists here (`link-fetch` is now `mailback-download.ts`; `0191` is
> `induction`, and the inbound-mail log is `0192`). It also states that the source
> file is deleted in a `finally` on success *or* failure, which is **no longer
> true and was the single most damaging bug in this subsystem** (§2.6).
>
> I have **not** seen the clone's source. Point me at its path and I'll turn this
> into an exact file-by-file diff.

---

## 1. The current end-to-end flow

Three ingress paths converge on **one queue** (`rta.import`) and **one worker**.

```
(A) Manual upload    browser → presigned PUT → S3 → /api/rta-imports/upload → row + enqueue
(B) Email mailback   RTA/firm mail → catch-all IMAP → poller → S3 → enqueue
(C) Link-delivered   mail with no attachment → allowlisted download → S3 → enqueue
```

### Poller tick — every `RTA_INBOX_POLLER_INTERVAL_MS` (default 120 s)

1. `loadRtaInboxConfig()` — `platform_settings['rta_inbox']`, IMAP password
   encrypted, `RTA_INBOX_*` env fallback, 60 s cache.
2. `processUnseenMailback(cfg, handleMessage)` builds an `InboundRawMessage`:
   `{ from, fromName, subject, text, html, date, recipients[], senderCandidates[], attachments[] }`.
3. `handleMessage(msg)`:
   1. `detectForwardingConfirmation(msg)` → `{ code, url, requester }`.
   2. **Route to a tenant, strongest path first:**
      - **(a) alias** — `resolveTenantByAddresses(recipients)` matches
        `rta-<token>@<domain>`. Unguessable, so it always wins.
      - **(b) registered sender** — `resolveTenantBySenders(senderCandidates)`
        matches the mailbox the firm forwards *from*, via
        `rta_forward_addresses.source_addresses`. This is what makes a **shared**
        `rta@<domain>` address usable. Deliberately weaker (a `From` is spoofable)
        and only consulted when (a) misses. **Two firms claiming one mailbox
        resolves to nothing, not a guess.**
      - **(c) confirmation requester** — for a Gmail forwarding-confirmation
        *only*. Google sends that mail itself (`From: forwarding-noreply@google.com`,
        no `X-Forwarded-For`), so the requesting mailbox parsed out of the body is
        the sole firm-identifying datum.
      - No match → `logInbound(unroutable)`, or `logInbound(confirmation)` with an
        actionable reason if it was a confirmation.
   3. `stampReceived` + `recordForwardingConfirmation`. A confirmation with no
      attachments logs `confirmation` and returns.
   4. `getMailbackPasswords(tenantId)` — CAMS + KFintech ZIP passwords, once.
   5. **Attachments:** `isImportableAttachment` → `classifyMailback(filename, from)`
      → `ingestAttachment` (sha256 in-flight dedup → `putObject` → insert
      `rta_file_imports` → enqueue `rich-import` | `import`).
   6. **Links — only when `queued === 0`:** `extractRtaDownloadLinks(text, html)`,
      first 3 by rank → `fetchRtaDownload` → `classifyMailback(downloadedName)` ??
      `classifyMailbackFromText(subject, text+html)` → `ingestAttachment`,
      **break on first success** (one report per mail).
   7. `logInbound` with `imported | duplicate | no_attachment | confirmation`; the
      whole body is wrapped in try/catch → `error`.
4. **Hourly, if `deleteAfterImport`:** `sweepImportedMail(cfg, retentionDays)`.

### Import worker — `rta.import`, concurrency 1

```
importAlreadyFinished? → delete object, return          (stalled-job re-run guard)
status→parsing → getObjectBytes → size cap → sha256(original bytes)
 → unzip (WinZip-AES; retry password-free; OOXML passthrough)
 → decodeRtaToText            ← INSIDE the try that calls markFailed (§2.7)
 → free buffers → parse → ONE tenant tx, SET LOCAL statement_timeout='600s'
 → status + counters + errors + summary
finally: deleteObject ONLY IF importSucceeded()          ← NOT unconditional
```

Wrong-password archives short-circuit to **`rejected`**, not `failed`.

---

## 2. What the clone is missing — ordered by blast radius

### P0 — the book stays empty

**2.1 Single-quoted CSV — and there are TWO parsers.** CAMS quotes **every** CSV
field with `'`, not `"`:

```
'FOLIOCHK','INV_NAME','ADDRESS1',…
'3409723/63','Swapan Kumar Das','FLAT N-5,3RD FLOOR 28,P.N MALIA',…
```

Two failures at once: header cells keep their literal quotes so **no report
signature matches** ("header did not match any known report"), and any address
containing a comma splits into extra columns, shifting PAN/balance/scheme after
it — **silent corruption, not an error**.

- **Fix both, they are separate code paths:** `src/lib/rta/decode.ts`
  `splitDelimited()` (feed engine) **and** `src/lib/rta/csv.ts` `parseCsv()`
  (rich master path, via `parseRtaCsv` → `parseRtaRows`). Fixing only `decode.ts`
  moved the feed 0 → 22 rows while masters still failed.
- Rule: a quote only **opens** a field at field start, so `O'Brien` stays literal;
  `''` is an escaped quote; leading spaces still count as pre-field.
- `isCamsFile` signature is `foliochk, rupee_bal, clos_bal, pan_no, sch_name` —
  all present in R9/R4 CSV. Only the quoting ever broke matching.

**2.2 Missing report codes** in `detectKind()` (`classify-mailback.ts`):

| Code | Kind | Note |
|---|---|---|
| `MFSD311` | `folio_master_dump` | subscription-mode ≈ 211 |
| `WBR4` / `R4` | `folio_master_dump` | "Investors Static Details **with balance**" |
| `MFSD310` | `cas_holdings` | subscription-mode ≈ 203 |
| `WBR22` / `R22` | `cas_holdings` | AuM on a specific date by scheme by investor |
| `WBR49` / `R49`, `MFSD230/243/313` | `monthly_sip_book` | SIP/STP procured |

Boundary idiom is `(?=[._\-\s]|$)`, not `\b` — CAMS glues codes to numeric
prefixes (`…214436725R9.zip`). Explicit codes match **before** the loose keyword
patterns; R4 before R2; `r49` must not be swallowed by the `r4` boundary. Note
`WBR9C` does **not** match the `r9` regex — it survives only via the title
matcher below.

**2.3 Classify from the mail itself.** Add `classifyMailbackFromText(subject, body, from)`
plus a `REPORT_TITLES` table of **whole-phrase** regexes (folio-wise transaction /
investor transactions for a period / client-wise AUM / master AUM|investor master
details / investors static details / brokerage statement / SIP rejection).

KFintech omits the MFSD code from several subjects entirely. Text mode is
**codes-only for the keyword patterns** — a bare `/transaction/` would match
nearly every registrar mail, and CAMS' own subject "Investor **Transactions** for
a Period" would mis-file. Only explicit codes and whole titles are trusted in
prose.

**2.4 Link-delivered reports.** `imap.ts` must expose `html` — KFintech's link
only exists in the HTML part. Then wire `extractRtaDownloadLinks` /
`fetchRtaDownload` into `handleMessage` under `if (queued === 0)`. Assume
attachments only and you silently miss **exactly the largest reports**.

`mailback-download.ts` needs all of these, each one paid for:

- **https-only + host allowlist, re-validated on every redirect hop.** The URL
  comes from an email, so it is attacker-controlled. `camsonline.com.evil.com`
  and `notcamsonline.com` must both fail.
- **KFintech click-tracker decoding.** Every KFin link is
  `scdelivery.kfintech.com/c/?u=<dest>&p=…` where `<dest>` is URL-encoded then
  **shifted +1 char (ROT-1)**: `iuuqt%3B00ngt%2Flgjoufdi%2Fdpn` → `https://mfs.kfintech.com`.
  Decode with `charCodeAt(0) - 1` in `resolveTrackedUrl()` **before** judging or
  ranking anything.
- **`NEVER_A_REPORT` blocklist** (`funcodes|prodcode|images|png/jpg/css/js|unsubscribe|privacy|contact`)
  and drop `u=undefined`. Without it, every KFin mail "succeeded" on
  `FUNCODES-PRODCODE.xls` — KFintech's static fund-code master, 17,037 scheme
  codes, zero client data, always exactly 4,321,280 bytes. That is why KFin
  masters failed "header did not match any known report" **and** why 17,037
  transaction rows all skipped "not in client master".
- **Rank by decoded destination:** direct file → download endpoint → `.aspx` /
  bare host last. CAMS mails several links; footer/portal links return login
  pages.
- **`MIN_BYTES = 256` + `ERROR_BODY_RE`** (`invalid|error|unauthor|forbidden|expired|access denied|not found|no data|session`).
  A 200 is **not** proof of a file: KFin returned HTTP 200 + 15 bytes
  `"Invalid request"` as `text/plain`, which slipped past the HTML guard, got
  stored, and imported as `completed, rows 0` — a silent no-op that looked like
  success.
- **`sniffExtension()` on magic bytes** (PK → `.zip`, `d0cf11e0a1b11ae1` → `.xls`,
  else `.csv`), applied only when the name lacks a known extension. KFin paths end
  in an opaque token with no extension, and the pipeline keys off the extension to
  decide unzip-vs-parse — so a ZIP went to the CSV parser.
- 120 MB cap.

> **Standing conclusion:** KFintech link delivery **cannot** be automated — the
> real report sits behind a portal login. No code fix exists. The firm must switch
> the KFintech subscription to encrypted-**attachment** delivery. CAMS is fine
> (its `mailback*.camsonline.com/mailback_result/…zip` URLs carry the token inline).

### P0 — stability and data retention

**2.5 Spreadsheet size ceiling.** `XLSX.read()` materialises the whole workbook as
an in-memory cell graph — it does not stream. A real 482 MB CAMS `.dbf` (inside a
28.5 MB zip) held one core at 100 % for ~1 hour at 3.1 GB RSS and, because the
parse is synchronous, **starved the worker event loop — outbox, workflows,
campaigns, scheduled comms and the RTA poller all froze platform-wide**.

- `RtaFileTooLargeError` + `SPREADSHEET_MAX_BYTES` (default 150 MB, env
  `RTA_SPREADSHEET_MAX_BYTES`) in `decode.ts`, spreadsheet extensions only — CSV
  never enters SheetJS.
- The throw must sit **outside** `decodeRtaToText`'s catch-all, or the
  `buf.toString("utf8")` fallback allocates a ~460 MB string from the same buffer.
- Message must be actionable: *re-request with File Type = CSV.*

**2.6 Keep the source file on failure.** ⚠ **This is the correction to the pasted
walkthrough.** Purging in an unconditional `finally` made every failure permanent:
the commonest failure is a wrong ZIP password, and deleting the object means
fixing the password can **never** recover the file — the firm must re-request the
report from the registrar. A retry script built on the old assumption died 19/19
with `The specified key does not exist`.

```ts
} finally {
  if (localKey && (await importSucceeded(job.data))) {
    await deleteObject(localKey).catch(() => {});
  }
}
```

`importSucceeded()` **re-reads the row status** (`completed`/`partial`) from the
DB. It must not be inferred from "didn't throw" — the import records its own
failure and returns normally. Unknown status → keep the file.

**2.7 `decodeRtaToText` must sit inside the try that calls `markFailed`.** When it
sat outside, the size-guard's actionable message escaped to BullMQ and left the
row stuck in `parsing` forever.

**2.8 Wrong-password ZIPs are `rejected`, not `failed`.** Firms commonly subscribe
to the same registrar through more than one platform; those archives are
encrypted with *their* password, land in the same forwarded mailbox, and can
outnumber the firm's own files several to one. `failed` buries the real failures
and implies the operator has something to fix. Add `isWrongPasswordError()` +
`markRejected()`.

> Related field finding: of 47 CAMS files, 6 opened with the saved password and 13
> rejected it — **two CAMS streams with different passwords**, per-subscription,
> not per-report-kind. Both kinds appear in both groups. Multi-password support
> per registrar is still unbuilt; the workaround is unsubscribing the old stream.

**2.9 Reaper must respect a legitimate backlog.** With concurrency 1 a real queue
waits hours. Read actual BullMQ counts (`getJobCounts("wait","active","delayed","paused")`)
and only reap `uploaded`/`queued` when the queue is genuinely **idle**; raise the
`parsing` timeout 20 → 60 min; unreadable queue → reap nothing. Otherwise you
mark healthy queued rows "the worker was busy or restarting".

**2.10 `isoDateOrToday()` on period dates.** `periodStart`/`periodEnd` are min/max
of parsed row values. A KFin feed produced `period_start='42'`, `period_end='Status'`;
the `::date` cast rejected the **entire status UPDATE**, losing the real row counts
and surfacing a raw SQL dump as the failure reason. A wrong-but-valid date is
cosmetic; a failed status write is not.

### P1 — routing and confirmations

**2.11 Hybrid addressing** (migration `0193`). Alias stays primary; add a shared
`rta@<domain>` that routes on the registered sending mailbox.

- `source_addresses jsonb NOT NULL DEFAULT '[]'` + GIN (`jsonb_path_ops`).
- `resolveTenantBySenders()` — `LIMIT 2` to detect ambiguity → `{ row: null, ambiguous: true }`.
- `setSourceAddresses()` rejects an address already claimed by another firm at
  registration, so you get a clear error rather than mail that can never route.
- Use `jsonb_exists_any(col, ARRAY[…]::text[])`, **not** `?|` — a bare `?` in
  Drizzle `sql`` ` is a driver-placeholder footgun.
- `imap.ts` `senderCandidates` from `X-Forwarded-For`, `Return-Path`,
  `Resent-From`, `Sender`, with the visible `From` **last** (on a manual forward
  the `From` *is* the firm).

**2.12 Forwarding-confirmation handling.**
- **Strip URLs before scanning for the code.** Gmail's link-only mail ends in
  `answer.py?answer=184973`, and `\b(\d{6,10})\b` returns that support-article id
  as the code. Prefer a number labelled "confirmation code"; a link-only
  confirmation legitimately has **no** code — return null, not garbage.
- Prefer `/mail/vf-` (**confirm**) over `/mail/uf-` (**cancel**). Both appear in
  that body; grabbing `uf-` silently cancels the user's request.
- Extract the requester (`"<addr> has requested to automatically forward"` /
  subject `"Receive Mail from <addr>"`) and use it as routing path (c).
- An unattributable confirmation logs `confirmation` with a *register that
  mailbox* hint, not buried in `unroutable`.

### P1 — observability

**2.13 `rta_inbound_messages`** (migration `0192`) supersedes
`rta_inbound_quarantine`, which had no UI at all.

- Outcomes `imported | duplicate | confirmation | no_attachment | unroutable | error`;
  per-attachment verdicts in `attachments jsonb`.
- Partial unique index on `message_id` + `ON CONFLICT … DO UPDATE`, so a message
  reprocessed after a crash-before-`\Seen` refreshes rather than duplicates.
- `tenant_id` **nullable** — unroutable mail is exactly the mail worth keeping.
  RLS `app_is_platform_admin() OR tenant_id = app_tenant_id()`.
- Recording lives in **one wrapper around `handleMessage`**, not at each return
  point. The ones that get forgotten are always the *success* paths — and then a
  delivered-and-imported mail looks identical to one that never arrived.
- Backfill guarded by `to_regclass(...) IS NOT NULL` + `ON CONFLICT DO NOTHING`
  (two quarantine rows can share a `message_id`).
- **Known gap, worth closing in the clone:** the table stores `recipients` but not
  `senderCandidates`, so a sender-match failure can't be fully diagnosed from the
  log alone.

**2.14 Admin surfaces.** `/api/super-admin/rta-inbound-mail` + page +
`RtaInboundMailLog.tsx` + AdminShell nav; `RtaInboxSettingsForm` gains the cleanup
toggle; `RtaMailbackCard` gains the shared address and source-mailbox editor with
the "address already in use" warning.

### P2 — mailbox hygiene

**2.15 Cleanup sweep** (migration `0194`, `mail_deleted_at`), **ships disabled**.
Safe because bytes go to S3 *before* the import is queued and the log row survives
the mail. Delete only when `outcome='imported'` **and** every queued attachment's
`rta_file_imports.status` ∈ `{completed, partial}` **and** past `retentionDays`
**and** a `message_id` exists — so a failed import keeps its mail for re-run;
unroutable/error/no_attachment are never touched.

`deleteMessagesByMessageId` matches on **Message-ID, not UID** — a UID is only
valid alongside the mailbox's `UIDVALIDITY`, so after a reset a stale UID points
at a *different* message. Stamp `mail_deleted_at` only for IDs that actually went.

**2.16 `inbox-config`:** `deleteAfterImport` (default off) + `retentionDays`
(default 7, clamped 0–365), in `platform_settings` with
`RTA_INBOX_DELETE_AFTER_IMPORT` / `RTA_INBOX_RETENTION_DAYS` env fallback. Hourly,
not per tick — it opens its own IMAP session.

---

## 3. Migrations

| # here | What |
|---|---|
| `0192_rta_inbound_mail_log.sql` | `rta_inbound_messages` + RLS + quarantine backfill |
| `0193_rta_forward_source_addresses.sql` | `source_addresses` jsonb + GIN |
| `0194_rta_inbound_mail_cleanup.sql` | `mail_deleted_at` + partial index |

**Renumber to the clone's own sequence and run the duplicate check first.** A
number collision makes the migrator skip files silently — that is exactly how the
`0191` mismatch between these two trees arose.

---

## 4. Config and ops

```
RTA_INBOX_HOST / _PORT / _SECURE / _USER / _PASS / _DOMAIN
RTA_INBOX_POLLER_INTERVAL_MS      default 120000
RTA_INBOX_DELETE_AFTER_IMPORT     0|1
RTA_INBOX_RETENTION_DAYS          default 7
RTA_SPREADSHEET_MAX_BYTES         default 157286400 (150MB)
ALLOW_SYSTEM_TX=1                 required by the poller
```

Worker group `rta` starts both the import worker and the inbox poller. Import
worker **concurrency stays 1**.

### Operational constraints that are not code

- **Master before feed.** Feed processors resolve an investor by PAN, then by an
  existing folio. Most feeds are folio-keyed with no PAN column. A KFintech feed
  parsed 17,037 rows and skipped every one — *"not in client master"*. Import
  WBR9/MFSD211 first.
- **Registrar subscription settings decide whether any of this works:**
  - `File Type = CSV **with headers** (CSVWH)` — reports are identified by matching
    the header row; a headerless file fails as unrecognised or eats the first data row.
  - `Funds = ALL` — a hand-picked AMC list silently omits those AMCs forever.
  - `Delivery = encrypted ATTACHMENT`, not download link — mandatory for KFintech.
  - `Date range = 1 day` for the daily feed. A 15-day window is what pushed CAMS
    over the size threshold and into link delivery in the first place.

### If the clone is the single-tenant VPS build

Your `RTA-IMPORT-PROMPT-SINGLE-TENANT-VPS.md` §2 says drop `rta_forward_addresses`.
That still holds and makes §2.11 mostly moot — with one firm there is nothing to
route, so skip `source_addresses` / `resolveTenantBySenders` and attribute every
message to `TENANT_ID`. **Keep** §2.13 (the log), §2.15–2.16 (the sweep) and every
P0 item: those are about parsing, memory and retention, not tenancy.

---

## 5. Acceptance tests

1. A **CAMS single-quoted CSV** master imports — headers match, an address
   containing a comma stays in one column. Test the **rich** and **feed** paths
   separately; they use different parsers.
2. `WBR4`, `WBR22`, `MFSD311`, `MFSD313` each classify to the right kind; `WBR9C`
   classifies via the title matcher.
3. A KFin click-tracker link decodes (ROT-1) to its real destination before ranking.
4. `FUNCODES-PRODCODE.xls` is rejected as never-a-report, not imported as `rows 0`.
5. HTTP 200 + `"Invalid request"` (15 bytes, text/plain) is refused.
6. An extensionless ZIP download is sniffed and unzipped, not sent to the CSV parser.
7. `camsonline.com.evil.com`, `notcamsonline.com`, and an allowlisted link that
   **redirects** off-allowlist are all blocked.
8. A >150 MB `.dbf` fails in seconds with the "re-request as CSV" message; other
   background jobs keep ticking throughout; the row lands `failed`, not stuck in
   `parsing`.
9. **A wrong-password import leaves the S3 object in place** — fix the password,
   re-queue, and it imports.
10. A queued backlog is not reaped while the queue is busy.
11. A Gmail confirmation yields the real code (not `184973`) and the `vf-` link.
12. Shared-address mail: registered sender routes; unregistered quarantines;
    double-registered quarantines with the ambiguity reason.
13. Every one of the above appears in Inbound Mail with the right outcome —
    including the successful ones.
14. With cleanup on, an imported mail past retention is deleted; a mail whose
    import **failed** is still there.
