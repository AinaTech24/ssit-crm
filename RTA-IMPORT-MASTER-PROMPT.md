# Master Prompt — Implement the RTA Import pipeline

## ⚠ Read this before using the prompt

**This spec will NOT reproduce the pipeline exactly. If you want it exact, copy
the code — you already have it in the clone.**

The implementation is ~7,000 lines:

| Part | Lines | Reproducible from a spec? |
|---|---|---|
| Architecture, tables, queue, S3, worker | ~2,000 | **Yes** — that is what this doc is for |
| `kfintech.ts` (~121-column MFSD211 map) | 392 | **No** |
| `cams.ts` (R9 combined master+holdings) | 224 | **No** |
| `parsers.ts` (all other report kinds) | 583 | **No** |
| `process.ts` / `import.ts` (apply + upsert) | 1,452 | Partly — rules are in §5.6, code is not |

The parsers are **empirical**. The formats are undocumented; those column maps
came from staring at real registrar files. A spec cannot regenerate them, and an
AI asked to "write the KFintech parser" will produce plausible-looking mappings
that are wrong — which is the worst outcome available, because it looks like it
works while writing wrong bank accounts, wrong nominees and misattributed units
into live client records.

### Do this instead

**1. Copy these files verbatim from the original repo:**

```
src/lib/rta/**                       (18 files — the whole directory)
src/workers/rta-import-worker.ts
src/workers/rta-inbox-poller.ts
src/db/schema/rta_imports.ts
src/db/schema/rta_forward_addresses.ts
src/db/schema/rta_inbound_messages.ts
src/app/api/rta/**                   (import, import-async, import-status, import-url)
src/app/api/rta-imports/**           (route, upload, upload-url, bulk, [id])
src/app/api/integrations/rta-mailback/**
src/app/api/super-admin/rta-inbox/**
src/app/dashboard/rta-imports/**
src/app/dashboard/imports/rta/**
```

**2. Make sure these supporting modules exist (they are imported by the above):**

```
@/db/client                      withTenant / withSystem
@/db/schema                      barrel — must re-export the 3 RTA tables
@/db/schema/tenant_integrations
@/lib/storage/s3                 presignedPutUrl / presignedGetUrl
@/lib/crypto                     AES-256-GCM (inbox + mailback passwords)
@/lib/comms/imap                 IMAP client for the poller
@/lib/comms/connection-error
@/lib/integrations/cams-feed-parser
@/lib/observability/capture
```

**3. npm dependencies:**

```
@zip.js/zip.js   AES-encrypted zip reading (stdlib and most zip libs cannot)
xlsx             .xls / .xlsx sheets
bullmq + ioredis job queue for the worker
drizzle-orm      queries
```

**4. Port the migrations** for the three tables, including
`ENABLE`/`FORCE ROW LEVEL SECURITY` and a `tenant_isolation` policy on each.

**5. Register the worker** in your worker entry point, at **concurrency 1**.

### So what is the prompt below for?

Three real uses:

- **Understanding** — hand it to whoever maintains the copied code so the design
  and its constraints are legible.
- **Adapting** — if the clone's schema, storage or queue differs, this tells you
  what each piece must still guarantee.
- **Rebuilding the non-parser parts** if you deliberately want a different
  architecture. Keep the copied parsers even then; they are the irreplaceable bit.

---

> Paste everything below the line into your AI agent working on the cloned CRM.
> It is written to be self-contained: it assumes no access to the original repo.

---

You are implementing the **RTA reverse-feed import** for a multi-tenant SaaS CRM
used by Indian Mutual Fund Distributors (MFDs). Build it exactly as specified.

## 0. Domain context (read first — the design follows from this)

In India, mutual fund records live with two **Registrars & Transfer Agents (RTAs)**:
**CAMS** and **KFintech**. A distributor (identified by an **ARN**) subscribes to
"**mailback**" reports — the RTA emails them scheduled files about their own book:
daily transactions, SIP bounces, mandate status, monthly brokerage, and a full
folio/investor master dump.

Four facts drive every design decision:

1. **The files are not a documented API.** They are spreadsheets whose columns
   vary by registrar, by report code, by MFD, and sometimes month to month.
2. **They arrive password-protected.** Typically WinZip-**AES** encrypted ZIPs —
   a format Node's stdlib and most zip libraries cannot read.
3. **They are big.** A folio master can be a ~10 MB zip expanding to a very large
   spreadsheet.
4. **The RTA is authoritative for the master data, never for the relationship.**
   It knows the client's PAN, address, bank, nominees and holdings. It knows
   nothing about which RM owns them, their risk profile, or your internal tags.

## 1. Three ingestion paths (build all three; they converge)

```
 (A) Manual upload ─┐
 (B) Rich master ───┼──► S3 object ──► rta_file_imports row ──► queue ──► WORKER
 (C) Email forward ─┘                                                       │
                                                                            ▼
                                              decode → classify → parse → normalize → upsert
```

**All three must converge on the same worker.** Do not write a second parser for
the email path — that is how the two paths drift and one silently rots.

### (A) Manual upload — the routine path
The ops user picks a file, optionally states source/kind (else auto-detect), and
supplies the ZIP password. Used for the daily transaction feed, SIP rejections,
mandate status, brokerage, etc.

### (B) Rich master / holdings import
Same mechanism, different payload: the full folio + investor master (CAMS "R9",
KFintech "MFSD211"/"MFSD203"). This one **creates and updates investors and
folios**, so it is the highest-risk path and gets a dry-run preview.

### (C) Automated email forwarding (the one that makes it hands-off)
One **platform-level catch-all mailbox** (e.g. `rta@yourcrm.com`). Each tenant is
issued a unique forwarding address; they set their mail client to auto-forward
RTA mail to it. A poller reads the mailbox and feeds attachments into the same
pipeline.

## 2. Data model

Three tables. All tenant-scoped with row-level security, except where noted.

### `rta_file_imports` — one row per file, the audit spine
```
id, tenant_id,
source        enum: cams | kfintech | mfu | bse_star_mf | nse_nmf2
kind          enum: see §3
file_name, file_key (S3), file_size_bytes,
file_checksum        sha256 — THE duplicate-detection key
status        enum: uploaded | parsing | completed | partial | failed | rejected
parsed_at,
rows_total, rows_imported, rows_skipped, rows_failed,
errors        jsonb  [{ row, reason }]
summary       jsonb  free-form per-kind stats
remarks, uploaded_by, deleted_at, timestamps
```

### `rta_forward_addresses` — per-tenant inbound address (path C)
```
id, tenant_id,
address              the unique forwarding address issued to this tenant
token                the unguessable part of that address
is_active,
source_addresses     jsonb — allowlist of sender addresses seen/accepted
verified_at, last_received_at,
forwarding_confirm_code / _url / _at   ← see §6.4
```

### `rta_inbound_messages` — every email seen, accepted or not
```
id, tenant_id (nullable — unresolved mail has no tenant yet),
forward_address_id, message_id, from_address, from_name, to_address,
recipients jsonb, subject, body_snippet, received_at,
outcome    enum-ish: queued | duplicate | unmatched | quarantined | error …
reason,
attachment_count, queued_count, duplicate_count,
attachments jsonb  [{ filename, classified_as, outcome, reason }]
mail_deleted_at, created_at
```

> `tenant_id` is nullable here on purpose: mail that cannot be resolved to a
> tenant must still be logged, or unroutable mail becomes invisible.

## 3. File kinds (drives cadence warnings + which tables get written)

```
Daily      daily_transaction_feed   sip_rejection_report
           nach_mandate_status      redemption_report
Weekly     wbr_weekly_business
Monthly    monthly_brokerage        monthly_aum_statement    monthly_sip_book
Quarterly  folio_master_dump
Ad-hoc     corporate_actions        cas_holdings
```

Keep a **file-type catalog** module holding, per kind: human label, description,
expected cadence (powers "next expected / late by" nudges), which downstream
tables it populates, and filename hints used for auto-detection.

## 4. Module layout

```
lib/rta/
  index.ts            entry: detect RTA by header signature → dispatch to parser
  types.ts            RtaFolioRecord + RtaParseResult — the ONE normalized shape
  file-types.ts       the catalog from §3
  decode.ts           ANY artefact → canonical pipe-delimited text
  unzip.ts            AES-zip extraction
  xls.ts              binary .xls (BIFF) + HTML-masquerading-as-.xls → rows
  csv.ts              dependency-free RFC-4180 CSV reader
  cams.ts             CAMS parser   (R9 = combined master + holdings)
  kfintech.ts         KFintech parser (MFSD211 folio/investor master, ~121 cols)
  parsers.ts          parsers for the non-master kinds → CanonicalRow[]
  resolve-scheme.ts   registrar scheme codes → canonical scheme via AMFI NAV master
  process.ts          apply parsed rows to downstream tables (per kind)
  import.ts           upsert investors + folios from RtaFolioRecord[]
  ingest.ts           shared: reserve row → run processor → stamp result
  classify-mailback.ts  attachment filename + sender → (source, kind)
  mailback-download.ts  fetch reports that arrive as a LINK, not an attachment
  inbox-config.ts       platform catch-all mailbox config (encrypted password)
  mailback-config.ts    per-tenant mailback settings (ZIP passwords)
workers/
  rta-import-worker.ts  the heavy parse+import, concurrency 1
  rta-inbox-poller.ts   IMAP poll → classify → S3 → enqueue
```

## 5. The pipeline, stage by stage

### 5.1 Receive & store
- Browser gets a **presigned S3 PUT URL** and uploads **directly to S3**.
  Do **not** route the file through your app server.
- Server records an `rta_file_imports` row (`status: uploaded`) and enqueues a job.
- Return immediately. The client polls a status endpoint by job id.

### 5.2 Decode — normalize the container
`decode.ts` turns **any** artefact into one canonical pipe-delimited text:
- AES ZIP → extract with the tenant's stored password
- `.xls` → could be real BIFF **or** HTML pretending to be xls. Handle both.
- `.xlsx` → zip-based
- `.dbf` → FoxPro (NAV masters)
- `.csv` / pipe text → pass through

### 5.3 Classify — decide (source, kind)
By **report code in the filename** plus **sender domain**:
- `R9` → CAMS master; `MFSD211` / `MFSD203` → KFintech master
- **Never guess.** If nothing matches, quarantine the attachment for a human and
  log why. A wrong guess writes bad data into client records.

### 5.4 Parse → normalize
Every master parser emits the same shape, **one record per folio**:

```ts
RtaFolioRecord = {
  pan, name, email, phone, address, dob, taxStatus, ckyc,
  bank: { accountNo, ifsc, name },
  nominees: [{ name, relationship, percentage }],
  amcCode, amcName, folioNumber, rta,
  schemes: [{ schemeCode, schemeName, isin, units, marketValue, nav }],
}
```

Non-master kinds parse to `CanonicalRow[]` instead, consumed by `process.ts`.

### 5.5 Resolve schemes
Registrars use internal codes (CAMS single-letter AMC codes like `P`/`K`,
KFintech numeric fund codes like `117`). Resolve to canonical identity via the
**AMFI NAVAll daily feed** (ISIN → AMFI scheme code → scheme name → AMC).

### 5.6 Import / upsert — the rules that matter most

> **The single most important section. Get this wrong and you destroy client data.**

- **Investors: upsert by PAN.** The feed **fills** contact / KYC / address /
  nominee / bank fields.
- **The feed must NEVER clobber CRM-owned fields**: `rm_id`, tags, risk profile,
  AUM, service tier, status, notes, health score, client category.
- **A blank feed value never overwrites existing data.** RTA files routinely ship
  empty cells; treating blank as "clear this" wipes good data.
- **Folios are feed-owned** — amc / rta / schemes / investor link are overwritten.
- **Rows with no PAN cannot resolve an investor** → skip and count. Do not invent
  a placeholder investor.
- **Idempotent**: re-importing the same file updates in place, never duplicates.
- Support **`dryRun: true`** — compute would-create / would-update counts with
  read-only SELECTs. This powers the preview, and it is what makes a first import
  safe to attempt.

### 5.7 Idempotency for transactional kinds
Every row carries a deterministic **`external_ref`** (order id / mandate id /
brokerage row id). Upsert keyed on that ref, so re-processing is a no-op.

### 5.8 Record the outcome
Stamp `status`, row counts, `errors[]`, and a per-kind `summary`. Every file ever
seen leaves a row — including rejected duplicates.

## 6. The email-forward path (C) in detail

### 6.1 Poll
Poll the catch-all mailbox over IMAP. Store its password **encrypted at rest**
(AES-256-GCM), decrypted only in-process. Make it configurable from an admin UI —
not an env var requiring redeploy.

### 6.2 Resolve tenant
From the **recipient** address → `rta_forward_addresses`. Unresolvable mail is
logged with `outcome: unmatched`, never silently dropped.

### 6.3 Handle attachments *and* links
Both registrars switch to a **download link** once the report exceeds a size
threshold — CAMS puts a `DownloadURL` ending `.zip` in the body (with
`Request Status: Link`), KFintech hides it behind a "Click Here" anchor. If you
assume every mailback carries its ZIP as an attachment, **you will silently miss
exactly the biggest files.**

### 6.4 Capture the forwarding confirmation code
When a user sets up auto-forwarding, Gmail/Outlook send a confirmation code to
the destination. Detect that mail, extract the code/URL, and surface it in the
tenant's UI — otherwise they cannot complete setup and will open a support ticket.

### 6.5 Bridge, don't re-implement
Push the still-password-protected attachment to S3 and enqueue **the same job**
the manual upload uses. The poller must contain **no parsing logic at all**.

## 7. Non-negotiable invariants (each one is a bug already paid for)

1. **Never parse in the web request.** A large master parse is CPU- and
   memory-heavy; doing it inline OOMs or event-loop-blocks the server and 503s
   the whole site for every user. Worker process, **concurrency 1**.
2. **Never route the upload through the app server.** The request-body cap
   truncates large files, and the failure surfaces as a baffling
   `End of central directory not found` from the unzip step.
3. **Never `buf.toString("utf8")` an RTA file.** Binary spreadsheets become
   garbage, and only plain CSV ever imports — an easy bug to ship and a hard one
   to notice.
4. **Dedupe by sha256 checksum**, not filename. The same report is forwarded
   repeatedly, often renamed.
5. **Never persist the ZIP password in the import row.** Store it in tenant
   config (encrypted) or accept it per upload.
6. **Blank ≠ delete.** (Restating §5.6 because it is the costliest mistake.)
7. **Quarantine on unknown**, never best-guess a classification.
8. **Log every inbound message**, including rejects — otherwise "the import
   didn't run" is undebuggable.
9. **Scope job results to the tenant that created them.** A status endpoint that
   returns any job's result by id leaks another firm's data.
10. **Build dates from local calendar parts, not `toISOString()`**, when deriving
    day keys. In IST (+5:30) local midnight converts to the *previous* UTC day.

## 8. Build order

1. `rta_file_imports` + RLS + the file-type catalog.
2. Presigned upload → import row → queue → worker skeleton → status endpoint.
3. `decode.ts` (+ `unzip`, `xls`, `csv`) — prove one real file becomes text.
4. One parser end-to-end (pick CAMS R9 **or** KFintech MFSD211) → `RtaFolioRecord[]`.
5. `import.ts` with **dryRun first**. Ship the preview before any write path.
6. The remaining kinds via `process.ts` + `external_ref` idempotency.
7. `resolve-scheme.ts` once an AMFI NAV master exists.
8. Path C: forward addresses → poller → classify → bridge → inbound log.
9. Cadence warnings ("monthly brokerage is 6 days late").

Steps 1–5 are independently valuable: an ops user manually uploading a master
with a dry-run preview is a working product before any email automation exists.

## 9. Acceptance tests

- Same file uploaded twice → second is `rejected` as duplicate; no double rows.
- Master import twice → identical row counts, zero new investors on the 2nd run.
- Feed row with blank email/phone → existing CRM values survive.
- Feed row for an existing investor → `rm_id`, tags, risk profile unchanged.
- Row with no PAN → skipped and counted, no partial investor created.
- Password-protected AES zip → extracts with stored password.
- `.xls` that is actually HTML → parses.
- Mail with a download link and no attachment → still imports.
- Mail to an unknown address → logged `unmatched`, no crash.
- 10 MB master upload → web server stays responsive throughout.
- Job status requested by another tenant → denied.

## 10. Caveats to carry into the build

- **Formats are undocumented and drift.** Parsers capture the *most common*
  layout observed; expect to extend per MFD. Write them to fail loudly on an
  unrecognised header rather than silently mapping the wrong column.
- **Column mapping is the long pole**, not the plumbing. Budget accordingly, and
  get real sample files for both registrars before estimating.
- **Test with real files.** Synthetic CSVs will not exercise AES zips, HTML-xls,
  or the link-instead-of-attachment case — which is where the real bugs live.
