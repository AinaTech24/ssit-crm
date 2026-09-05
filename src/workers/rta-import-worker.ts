/**
 * RTA import worker.
 *
 * Parsing a real RTA master (CAMS R9 / KFintech MFSD — a ~10 MB zip that
 * expands to a large spreadsheet) is CPU- and memory-heavy: it OOM-crashed or
 * event-loop-blocked the WEB server when done inside the upload request,
 * 503-ing the whole site for every user. So the upload route now only records
 * the import row + enqueues a job here; this worker does the actual work in the
 * isolated worker process (concurrency 1 — one heavy parse at a time).
 *
 * Flow per job:
 *   1. mark the rta_file_imports row `parsing`
 *   2. fetch the object from S3 by key, checksum it (dedupe)
 *   3. unzip (password) if needed, decode to canonical pipe text
 *   4. run processRtaFile() in one tenant transaction
 *   5. update the row with status + counters (completed | partial | failed | rejected)
 *
 * A reaper marks rows stuck in `parsing` (worker died mid-job) as failed so the
 * UI poll resolves instead of spinning forever.
 */

import { Worker } from "bullmq";
import IORedis from "ioredis";
import { createHash } from "crypto";
import { sql } from "drizzle-orm";
import { withTenant, withSystem } from "@/db/client";
import { processRtaFile } from "@/lib/rta/process";
import { decodeRtaToText } from "@/lib/rta/decode";
import { extractRtaFileFromZip } from "@/lib/rta/unzip";
// RTA zip is uploaded to S3 (full file, no web-server body cap), parsed, then
// deleted from S3 immediately — transient, never retained.
import { getObjectBytes, deleteObject } from "@/lib/storage/s3";
import type { RtaSource, RtaFileKind } from "@/db/schema/rta_imports";
import { captureError } from "@/lib/observability/capture";
import { parseRtaCsv, parseRtaRows } from "@/lib/rta";
import { Q } from "./queues";
import { importRtaFolios, type RtaImportSummary } from "@/lib/rta/import";
import { isSpreadsheet, readSpreadsheetToRows } from "@/lib/rta/xls";
import { RICH_KINDS } from "@/lib/rta/classify-mailback";
import { getMailbackPasswords, passwordCandidates } from "@/lib/rta/mailback-config";

export type RtaImportJob = {
  importId: string;
  tenantId: string;
  source: RtaSource;
  kind: RtaFileKind;
  /** S3 object key the browser PUT the file to. */
  key: string;
  filename: string;
  /** @deprecated single-password shape — still honoured, superseded by `passwords`. */
  password?: string;
  /** Every saved password for this source, tried in order until one opens the archive. */
  passwords?: string[];
  userId: string;
  branchId?: string | null;
  roles: string[];
};

const MAX_BYTES = 60 * 1024 * 1024;

async function markFailed(
  job: RtaImportJob,
  reason: string,
  extra?: { checksum?: string; sizeBytes?: number }
) {
  const ctx = { userId: job.userId, branchId: job.branchId ?? undefined, roles: job.roles };
  await withTenant(
    job.tenantId,
    async (tx) => {
      await tx.execute(sql`
        UPDATE rta_file_imports
        SET status = 'failed', parsed_at = now(), remarks = ${sanitizeText(reason.slice(0, 1000))},
            file_checksum = COALESCE(${extra?.checksum ?? null}, file_checksum),
            file_size_bytes = COALESCE(${extra?.sizeBytes ?? null}, file_size_bytes)
        WHERE id = ${job.importId}::uuid
      `);
    },
    ctx
  );
}

/**
 * A ZIP that will not open with THIS firm's saved password is almost never a
 * problem to fix — it is somebody else's file.
 *
 * The mailback address receives whatever the firm forwards, and firms commonly
 * subscribe to the same registrar through more than one platform. Those other
 * platforms' archives are encrypted with THEIR password, land in the same
 * mailbox, and can outnumber the firm's own files several to one.
 *
 * Reporting them as `failed` buried the real failures in noise and implied the
 * operator had something to fix. They are recorded as `rejected` — "not ours,
 * ignored" — which is exactly what the status already means.
 */
function isWrongPasswordError(message: string | undefined): boolean {
  return /invalid password|wrong password|password/i.test(message ?? "");
}

/**
 * Strip characters Postgres's `text` type rejects outright before a value ever
 * reaches a query.
 *
 * A CAMS `.dbf` master reaching the rich-import path with no `.dbf` support
 * (fixed above, in xls.ts) got read as latin-1 CSV text — turning its binary
 * field-descriptor table (which embeds NUL bytes by DBF's own format) into an
 * "unrecognised format" error message THAT ITSELF CONTAINED NUL BYTES. Writing
 * that message to `remarks` threw `invalid byte sequence for encoding "UTF8":
 * 0x00` — a Postgres text column cannot hold a NUL character at all — and because that
 * threw INSIDE the very statement recording the failure, the row was left
 * orphaned in `parsing` with no reason ever saved, rescued only later by the
 * 60-minute reaper.
 *
 * Fixing the DBF gap stops THIS file from producing NUL-laden text. This is
 * the second, independent layer: whatever OTHER file format someday produces
 * similar garbage, the write that records the failure must never be able to
 * fail because of it — recording *some* reason beats losing the reason AND
 * leaving the row to be silently reaped.
 */
function sanitizeText(s: string | null | undefined): string | null {
  if (s == null) return null;
  // eslint-disable-next-line no-control-regex -- deliberately stripping NUL + other C0 control chars
  return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
}

/** Merge the deprecated singular field with the new list, de-duplicated, in order. */
function candidatePasswords(job: { password?: string; passwords?: string[] }): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of job.passwords ?? []) {
    if (p && !seen.has(p)) {
      out.push(p);
      seen.add(p);
    }
  }
  if (job.password && !seen.has(job.password)) out.push(job.password);
  return out;
}

/**
 * Try every saved password against a ZIP until one opens it.
 *
 * A firm can hold more than one password for the same registrar — a second ARN
 * registered separately, a rotated password kept alongside the old one during
 * transition. Trying them all here is what makes "not ours" mean what it says:
 * a file is only rejected once EVERY password this firm owns has failed on it,
 * not just the first one we happened to try.
 *
 * Returns the opened file, or null with the LAST error seen (a non-password
 * error — corrupt archive, unsupported format — takes priority when mixed with
 * password errors, since that's the more actionable diagnosis to surface).
 */
async function openWithAnyPassword(
  buf: Buffer,
  passwords: string[]
): Promise<{ ok: true; data: Uint8Array; filename: string } | { ok: false; error: any; triedCount: number }> {
  const tryList = passwords.length ? passwords : [undefined];
  let lastNonPasswordErr: any = null;
  let lastErr: any = null;
  for (const pw of tryList) {
    try {
      const r = await extractRtaFileFromZip(new Uint8Array(buf), pw);
      return { ok: true, data: r.data, filename: r.filename };
    } catch (e: any) {
      lastErr = e;
      if (!isWrongPasswordError(e?.message)) lastNonPasswordErr = e;
    }
  }
  return { ok: false, error: lastNonPasswordErr ?? lastErr, triedCount: tryList.length };
}

/** Build the right message/status for an unzip failure, aware of how many passwords were tried. */
function classifyUnzipFailure(error: any, triedCount: number, hadAnyPassword: boolean): { rejected: boolean; message: string } {
  if (hadAnyPassword && isWrongPasswordError(error?.message)) {
    return {
      rejected: true,
      message:
        triedCount > 1
          ? `Not this firm's file — none of the ${triedCount} saved passwords opened the archive, so it was ignored. ` +
            `(Multiple mailback subscriptions, or another platform's reports, can arrive at the same address.)`
          : NOT_OUR_FILE,
    };
  }
  return { rejected: false, message: `Could not open the zip — ${error?.message ?? "unsupported archive"}.` };
}

async function markRejected(job: RtaImportJob, reason: string, extra?: { checksum?: string; sizeBytes?: number }) {
  const ctx = { userId: job.userId, branchId: job.branchId ?? undefined, roles: job.roles };
  await withTenant(
    job.tenantId,
    async (tx) => {
      await tx.execute(sql`
        UPDATE rta_file_imports
        SET status = 'rejected', parsed_at = now(), remarks = ${sanitizeText(reason.slice(0, 1000))},
            file_checksum = COALESCE(${extra?.checksum ?? null}, file_checksum),
            file_size_bytes = COALESCE(${extra?.sizeBytes ?? null}, file_size_bytes)
        WHERE id = ${job.importId}::uuid
      `);
    },
    ctx
  );
}

/** Shown on every archive we could not open — deliberately not phrased as an error. */
const NOT_OUR_FILE =
  "Not this firm's file — the archive is encrypted with a different password, " +
  "so it was ignored. (Other platforms' mailback reports can arrive at the same address.)";

/**
 * Idempotency guard. A worker restart (deploy / OOM) can leave a job 'stalled',
 * which BullMQ re-runs once. If the import already reached a terminal state the
 * re-run MUST be a no-op: the first run already deleted the transient S3 object,
 * so re-reading it throws "The specified key does not exist" — which, worse,
 * would CLOBBER a completed import back to failed. Skip when the row is terminal.
 */
async function importAlreadyFinished(job: {
  tenantId?: string;
  importId?: string;
  userId?: string;
  branchId?: string | null;
  roles?: string[];
}): Promise<boolean> {
  if (!job.tenantId || !job.importId || !job.userId) return false;
  try {
    return await withTenant(
      job.tenantId,
      async (tx) => {
        const r = await tx.execute(
          sql`SELECT status FROM rta_file_imports WHERE id = ${job.importId}::uuid LIMIT 1`
        );
        const st = (r.rows?.[0] as any)?.status as string | undefined;
        // ONLY a genuinely finished import counts. 'failed' and 'rejected' used
        // to be listed here too, which made every retry a silent no-op — and,
        // because the caller deletes the S3 object on this path, the retry also
        // DESTROYED the file it was meant to recover. That defeated the whole
        // point of keeping files on failure (see the `finally` block below):
        // re-queueing after a password fix deleted the archive instead of
        // importing it. A failed/rejected row must always be reprocessable.
        //
        // 'partial' is reprocessable too, and for the same reason: its skipped
        // rows are waiting on a folio master that may since have arrived. That
        // is safe because the row writes upsert, so a repeat is idempotent, and
        // because importSucceeded() no longer purges partial files — the object
        // is still there to re-read. Only 'completed' short-circuits, which is
        // the stalled-job case this guard was written for: that file IS gone.
        return st === "completed";
      },
      { userId: job.userId, branchId: job.branchId ?? undefined, roles: job.roles ?? [] }
    );
  } catch {
    return false; // can't check → let the job run rather than silently drop it
  }
}

/** The actual import. Exported so it can be unit-tested / invoked one-off. */
export async function runRtaImportJob(job: RtaImportJob): Promise<void> {
  const ctx = { userId: job.userId, branchId: job.branchId ?? undefined, roles: job.roles };
  const { importId, tenantId, source, kind, key, filename } = job;

  // 1. Mark parsing.
  await withTenant(
    tenantId,
    async (tx) => {
      await tx.execute(sql`
        UPDATE rta_file_imports SET status = 'parsing', parsed_at = now() WHERE id = ${importId}::uuid
      `);
    },
    ctx
  );

  // 2. Read the full file from S3 (uploaded directly by the browser).
  let buf: Buffer;
  try {
    buf = await getObjectBytes(key);
  } catch (e: any) {
    await markFailed(job, `Could not read the uploaded file from storage — ${e?.message ?? "object not found"}.`);
    return;
  }
  if (buf.length === 0) {
    await markFailed(job, "empty upload — no file received");
    return;
  }
  if (buf.length > MAX_BYTES) {
    await markFailed(job, "file too large (max 60 MB)");
    return;
  }

  // Checksum the ORIGINAL bytes so re-uploading the identical file dedupes.
  const checksum = createHash("sha256").update(buf).digest("hex");

  // NOTE: we deliberately do NOT hard-reject a re-uploaded (same-checksum) file.
  // The feed processors are upsert-idempotent (and the master/rich path upserts),
  // so re-importing is safe — and blocking it stranded users who needed to retry
  // a previously-failed or partial import. Re-import just refreshes in place.

  // 3. Unzip (password-protected RTA mailbacks) then decode to pipe text.
  let dataBuf = buf;
  let innerName = filename;
  const isZip = buf.length > 1 && buf[0] === 0x50 && buf[1] === 0x4b;
  if (isZip) {
    const passwords = candidatePasswords(job);
    const opened = await openWithAnyPassword(buf, passwords);
    if (!opened.ok) {
      const extra = { checksum, sizeBytes: buf.length };
      const verdict = classifyUnzipFailure(opened.error, opened.triedCount, passwords.length > 0);
      if (verdict.rejected) await markRejected(job, verdict.message, extra);
      else await markFailed(job, verdict.message, extra);
      return;
    }
    dataBuf = Buffer.from(opened.data);
    innerName = opened.filename;
  }

  // Decode can legitimately REFUSE — a spreadsheet too large to hold in memory
  // (RtaFileTooLargeError). That message tells the operator exactly what to
  // change, so it has to land on the row; letting it escape to BullMQ leaves the
  // row stuck in 'parsing' with the advice buried in the worker log.
  let text: string;
  try {
    text = decodeRtaToText(dataBuf, innerName);
  } catch (e: any) {
    await markFailed(job, e?.message ?? "Could not decode the file.", { checksum, sizeBytes: buf.length });
    return;
  }
  // Free the large buffers before the (memory-heavy) parse so they can be GC'd.
  dataBuf = Buffer.alloc(0);
  buf = Buffer.alloc(0);

  // 4 + 5. Process in one tenant transaction, then persist counters.
  try {
    await withTenant(
      tenantId,
      async (tx) => {
        let outcome;
        let failure: string | null = null;
        try {
          outcome = await processRtaFile(tx, { tenantId, source, kind, text });
        } catch (e: any) {
          failure = e?.message ?? "Unknown parser error";
        }

        if (failure || !outcome) {
          await tx.execute(sql`
            UPDATE rta_file_imports
            SET status = 'failed', parsed_at = now(), file_checksum = ${checksum},
                file_size_bytes = ${dataLen(text)},
                remarks = ${failure ?? "unknown error"}
            WHERE id = ${importId}::uuid
          `);
          return;
        }

        const status =
          outcome.rowsFailed > 0 || outcome.rowsSkipped > 0
            ? outcome.rowsImported === 0
              ? "failed"
              : "partial"
            : "completed";

        // "completed · 0 rows" reads exactly like a silent failure, and it sent
        // us hunting for a parser bug that did not exist. A registrar quite
        // legitimately returns a report with only a header row — KFintech's
        // MFSD313 SIP register does it whenever no SIP was registered in the
        // period. Say so, so the next person doesn't have to re-derive it.
        const emptyNote =
          outcome.rowsTotal === 0
            ? "The registrar returned an empty report — a header row and no data. Nothing to import; this is not an error."
            : null;

        await tx.execute(sql`
          UPDATE rta_file_imports
          SET status = ${status}, parsed_at = now(), file_checksum = ${checksum},
              remarks = COALESCE(${emptyNote}, remarks),
              period_start = ${isoDateOrToday(outcome.periodStart)}::date,
              period_end = ${isoDateOrToday(outcome.periodEnd)}::date,
              rows_total = ${outcome.rowsTotal},
              rows_imported = ${outcome.rowsImported},
              rows_skipped = ${outcome.rowsSkipped},
              rows_failed = ${outcome.rowsFailed},
              errors = ${JSON.stringify(
                // Postgres's jsonb parser rejects an embedded NUL character escape outright
                // ("unsupported Unicode escape sequence") — the same NUL
                // restriction as a text column, just enforced at JSON-parse
                // time instead of at the encoding layer. JSON.stringify
                // always escapes a raw NUL char in a JS string to that exact
                // sequence, so stripping it from each reason BEFORE
                // stringifying (not after — regexing finished JSON text is
                // fragile) is what keeps this cast from throwing the same way
                // the `remarks` write above did.
                outcome.errors.map((e) => ({ ...e, reason: sanitizeText(e.reason) }))
              )}::jsonb
          WHERE id = ${importId}::uuid
        `);
      },
      ctx
    );
  } catch (e: any) {
    await markFailed(job, e?.message ?? "import failed", { checksum });
  }
}

/** Byte length of the decoded text (file_size_bytes when the original buffer is freed). */
function dataLen(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

/**
 * Guard a derived period date before it reaches a `::date` cast.
 *
 * periodStart/periodEnd are the min/max of whatever the parser read out of the
 * date column. When a report has an unexpected layout those can come back as
 * junk — a real KFintech feed produced `period_start='42'`, `period_end='Status'`
 * — and Postgres then rejects the ENTIRE status UPDATE. The import's real row
 * counts were lost and the operator saw a raw SQL dump as the failure reason.
 *
 * A wrong-but-valid date is a cosmetic problem; a failed status write is not.
 */
function isoDateOrToday(v: unknown): string {
  const s = String(v ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date().toISOString().slice(0, 10);
  return Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()) ? new Date().toISOString().slice(0, 10) : s;
}

/**
 * Did this job's row actually end up imported? Drives whether the source file is
 * purged from S3 — a failed import KEEPS its file so a credential fix can retry
 * it. `partial` counts as done: rows landed, and the skipped ones are recorded
 * per-row, so re-running the whole file adds nothing.
 */
async function importSucceeded(job: { importId?: string }): Promise<boolean> {
  if (!job?.importId) return false;
  try {
    return await withSystem(async (tx) => {
      const r = await tx.execute(sql`
        SELECT status FROM rta_file_imports WHERE id = ${job.importId}::uuid LIMIT 1
      `);
      const status = (r.rows[0] as any)?.status as string | undefined;
      // 'partial' deliberately does NOT purge. A partial import is one where
      // some rows were skipped for a reason that resolves later — nearly always
      // "folio not in client master", because the transaction feed arrived
      // before the folio master. Once the master imports, re-running the feed
      // picks those rows up. Purging on 'partial' threw the file away and made
      // the skipped rows permanently unrecoverable: one KFintech feed for VSN
      // Financial Services dropped 198 rows across 11 folios that way.
      return status === "completed";
    });
  } catch {
    // If we can't tell, keep the file. Retaining a stale object is cheap;
    // deleting one that's still needed is not recoverable.
    return false;
  }
}

/**
 * Reap rows stuck in `parsing` — if the worker died mid-parse (e.g. OOM on a
 * huge file), nothing resets the row and the UI poll spins forever. Mark them
 * failed after 20 min. Never auto-retried (a half-applied import is upsert-safe
 * but re-running a giant file just risks another OOM — the user re-uploads).
 */
async function reapStuckParsing(): Promise<number> {
  // Is anything actually moving through the queue right now? Concurrency is 1,
  // so a legitimate backlog can sit at 'uploaded' for a long time — far past any
  // fixed timeout. Reaping on age alone marked those queued-but-waiting rows
  // "the worker was busy or restarting", which was both wrong and alarming.
  // Only declare a queued row lost when the queue itself is genuinely empty.
  let queueBusy = false;
  try {
    const q = Q.rtaImport();
    const counts = await q.getJobCounts("wait", "active", "delayed", "paused");
    queueBusy = (counts.wait ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0) + (counts.paused ?? 0) > 0;
  } catch {
    // Can't read the queue → assume busy and reap nothing. A row left spinning
    // is recoverable; a wrongly-failed row confuses the operator.
    queueBusy = true;
  }

  const reaped = await withSystem(async (tx) => {
    // (1) Parse started but never finished (worker died/OOM mid-parse).
    // (2) Enqueued but no job exists to run it — only when the queue is idle.
    const rows = await tx.execute(sql`
      UPDATE rta_file_imports
      SET status = 'failed', parsed_at = COALESCE(parsed_at, now()),
          remarks = COALESCE(NULLIF(remarks, ''), 'Import didn''t finish — the worker restarted mid-parse. Re-upload to retry.')
      WHERE (
        (status = 'parsing' AND parsed_at IS NOT NULL AND parsed_at < now() - interval '60 minutes')
        ${queueBusy ? sql`` : sql`OR (status IN ('uploaded', 'queued') AND created_at < now() - interval '20 minutes')`}
      )
      RETURNING id
    `);
    return rows.rows.length;
  });
  return reaped;
}

/**
 * Rich master/holdings import (the /dashboard/imports/rta importer). Unlike the
 * feed processor above, this resolves real AMC + scheme names and CREATES the
 * full client book (investors + folios + families) via importRtaFolios — and it
 * supports a dry-run preview. Heavy CAMS R9 (.xls ~50 MB) parsing runs here in
 * the isolated worker (concurrency 1) instead of the web request. Returns the
 * summary as the job's return value so the UI can poll for it.
 */
export type RichImportJob = {
  mode: "rich";
  tenantId: string;
  key: string;
  filename: string;
  /** @deprecated single-password shape — still honoured, superseded by `passwords`. */
  password?: string;
  /** Every saved password for this source, tried in order until one opens the archive. */
  passwords?: string[];
  rta: string;
  reportType: string;
  dryRun: boolean;
  assignToMe: boolean;
  userId: string;
  branchId?: string | null;
  roles: string[];
  /** When set, this is the UNIFIED importer flow: update this rta_file_imports
   *  row with the outcome (so it shows on the /dashboard/rta-imports dashboard),
   *  and the dialog polls the row. When absent, it's the standalone job-poll flow. */
  importId?: string;
};

export type RichImportResult = {
  ok: boolean;
  error?: string;
  /** True when the file simply is not this firm's (wrong-password archive). */
  notOurs?: boolean;
  source?: string;
  reportType?: string;
  totalRows?: number;
  missingPan?: number;
  summary?: RtaImportSummary;
};

/** Progress payload the UI polls for (via job.progress on import-status). */
export type RichImportProgress = { phase: string; pct: number; done?: number; total?: number };

async function computeRichImport(
  job: RichImportJob,
  report?: (p: RichImportProgress) => void
): Promise<RichImportResult> {
  const ctx = { userId: job.userId, branchId: job.branchId ?? undefined, roles: job.roles };

  report?.({ phase: "Reading file", pct: 4 });
  let buf = await getObjectBytes(job.key);
  if (buf.length === 0) return { ok: false, error: "empty upload — no file received" };
  if (buf.length > 80 * 1024 * 1024) return { ok: false, error: "file too large (max 80 MB)" };

  // Unzip password-protected RTA mailbacks to their inner file.
  let data: Uint8Array = new Uint8Array(buf);
  let innerName = job.filename;
  const isZip = buf.length > 1 && buf[0] === 0x50 && buf[1] === 0x4b;
  if (isZip) {
    const passwords = candidatePasswords(job);
    const opened = await openWithAnyPassword(buf, passwords);
    if (!opened.ok) {
      const verdict = classifyUnzipFailure(opened.error, opened.triedCount, passwords.length > 0);
      return { ok: false, notOurs: verdict.rejected, error: verdict.message };
    }
    data = opened.data;
    innerName = opened.filename;
  }
  buf = Buffer.alloc(0); // free the original before the heavy parse

  report?.({ phase: "Parsing file", pct: 8 });
  // Binary Excel (CAMS R9 .xls) via SheetJS; anything else as latin-1 CSV.
  const parsed = isSpreadsheet(data, innerName)
    ? parseRtaRows(readSpreadsheetToRows(data))
    : parseRtaCsv(new TextDecoder("latin1").decode(data));

  if (parsed.source === "unknown" || parsed.folios.length === 0) {
    return {
      ok: false,
      error: parsed.warnings[0] ?? "Unrecognised RTA file — header did not match a known report.",
      source: parsed.source,
      reportType: parsed.reportType,
      totalRows: parsed.totalRows,
    };
  }
  if (job.rta && parsed.source !== job.rta) {
    return { ok: false, error: `You selected ${job.rta.toUpperCase()}, but this file looks like ${parsed.source.toUpperCase()} ${parsed.reportType}. Pick the matching RTA, or the right file.` };
  }
  if (job.reportType && parsed.reportType && job.reportType !== parsed.reportType) {
    return { ok: false, error: `You selected file type ${job.reportType}, but this file is ${parsed.reportType}. Pick the matching file type.` };
  }

  const { loadTenantLicense } = await import("@/lib/auth/license");
  const license = await loadTenantLicense(job.tenantId, undefined);
  report?.({ phase: "Importing records", pct: 15, total: parsed.totalRows });
  const summary = await withTenant(
    job.tenantId,
    (tx) =>
      importRtaFolios(tx as any, job.tenantId, parsed.folios, {
        dryRun: job.dryRun,
        assignRmId: job.assignToMe ? job.userId : null,
        reportType: parsed.reportType,
        kind: parsed.kind === "holdings" ? "holdings" : parsed.kind === "full" ? "full" : "master",
        // Clients fill 15→40%, folios 40→85% of the bar; the UI derives the ETA.
        onProgress: (phase, done, total) => {
          const frac = done / Math.max(1, total);
          const pct =
            phase === "clients"
              ? 15 + Math.round(25 * frac)
              : 40 + Math.round(45 * frac);
          report?.({
            phase: phase === "clients" ? "Importing clients" : "Importing folios",
            pct,
            done,
            total,
          });
        },
      }),
    ctx
  );

  // After a REAL import, revalue folios + roll holdings up to investors.aum so
  // the profile headlines/AUM reflect the freshly-created book immediately.
  if (!job.dryRun) {
    report?.({ phase: "Finalizing valuations", pct: 88 });
    try {
      const { revalueAllFolios, recomputeCombinedAum } = await import("@/lib/finance/aum-persist");
      await withTenant(
        job.tenantId,
        async (tx) => {
          await revalueAllFolios(tx);
          await recomputeCombinedAum(tx);
        },
        ctx
      );
    } catch (err) {
      captureError("[rta-import] post-import AUM rollup failed", err, { tenantId: job.tenantId });
    }
  }

  return {
    ok: true,
    source: parsed.source,
    reportType: parsed.reportType,
    totalRows: parsed.totalRows,
    missingPan: parsed.missingPan,
    summary,
  };
}

/**
 * Run a rich import. In the UNIFIED flow (job.importId set) it also writes the
 * outcome onto the rta_file_imports row so it appears on the dashboard and the
 * upload dialog's poll resolves. Always returns the result (used by the
 * standalone job-poll flow).
 */
export async function runRichImportJob(
  job: RichImportJob,
  report?: (p: RichImportProgress) => void
): Promise<RichImportResult> {
  // Capture ANY throw (parse error, DB error, quota throw, transient failure)
  // so the rta_file_imports row is marked failed with the REAL reason here —
  // instead of being left in `parsing` for the 20-min reaper to fail with the
  // generic "worker was busy or restarting" message (which masks the cause and
  // makes a master import look perpetually stuck). This mirrors the feed path's
  // try/catch in runRtaImportJob.
  let result: RichImportResult;
  try {
    result = await computeRichImport(job, report);
  } catch (e: any) {
    captureError("[rta-import] rich import threw", e, { tenantId: job.tenantId, importId: job.importId });
    result = { ok: false, error: e?.message ? `Import failed: ${e.message}` : "Import failed unexpectedly." };
  }
  if (job.importId) {
    const ctx = { userId: job.userId, branchId: job.branchId ?? undefined, roles: job.roles };
    await withTenant(
      job.tenantId,
      async (tx) => {
        if (!result.ok) {
          // "Not ours" is a routine no-op, not a failure the operator must act on.
          const status = result.notOurs ? "rejected" : "failed";
          await tx.execute(sql`
            UPDATE rta_file_imports SET status = ${status}, parsed_at = now(),
              remarks = ${(result.error ?? "import failed").slice(0, 1000)}
            WHERE id = ${job.importId}::uuid
          `);
          return;
        }
        const s = result.summary;
        const imported = (s?.folios.created ?? 0) + (s?.folios.updated ?? 0);
        const skipped = s?.folios.skippedNoPan ?? 0;
        const total = s?.folios.total ?? 0;
        const status = imported === 0 ? "failed" : skipped > 0 ? "partial" : "completed";
        const remarks = s
          ? `${s.investors.created} new + ${s.investors.updated} updated clients · ${s.folios.total} folios · ${s.amcs.length} AMCs`
          : null;
        await tx.execute(sql`
          UPDATE rta_file_imports SET status = ${status}, parsed_at = now(),
            rows_total = ${total}, rows_imported = ${imported}, rows_skipped = ${skipped}, rows_failed = 0,
            remarks = ${remarks},
            summary = ${s ? JSON.stringify(s) : null}::jsonb
          WHERE id = ${job.importId}::uuid
        `);
      },
      ctx
    );
  }
  return result;
}

/**
 * Re-try every archive we previously gave up on, using the firm's CURRENT
 * password list.
 *
 * A `rejected` row means "no saved password opened this archive". That is the
 * normal outcome for another platform's report arriving at the same address —
 * but it is ALSO what a firm's own files look like before they have entered the
 * password for that ARN's mailback subscription. Since the source file is kept
 * on failure (see the purge note in the worker below), adding the missing
 * password can recover the whole backlog — but only if something goes back and
 * re-tries it. Without this, a firm fixes their password and still sees months
 * of "not ours" rows, because nothing ever revisits them.
 *
 * Only files that ACTUALLY OPEN are re-queued; anything still locked is left
 * `rejected` and counted, so a rescan can never spam the import dashboard with
 * files that belong to somebody else.
 */
export type RtaRescanJob = {
  mode: "rescan";
  tenantId: string;
  source: RtaSource;
};

/** Bound the work a single rescan does — a busy shared address holds thousands. */
const RESCAN_MAX_FILES = 1000;
const SYSTEM_USER = "00000000-0000-0000-0000-000000000000";

export async function runRejectedRescanJob(
  job: RtaRescanJob
): Promise<{ requeued: number; stillLocked: number; scanned: number }> {
  const cfg = await withTenant(job.tenantId, async (tx) => getMailbackPasswords(tx, job.tenantId));
  const passwords = passwordCandidates(cfg, job.source).map((e) => e.password);
  if (!passwords.length) return { requeued: 0, stillLocked: 0, scanned: 0 };

  const rows = await withTenant(job.tenantId, async (tx) => {
    const r = await tx.execute(sql`
      SELECT id, kind, file_name, file_key
      FROM rta_file_imports
      WHERE deleted_at IS NULL
        AND source = ${job.source}
        AND status = 'rejected'
        AND file_key IS NOT NULL
      ORDER BY created_at ASC
      LIMIT ${RESCAN_MAX_FILES}`);
    return r.rows as Array<{ id: string; kind: RtaFileKind; file_name: string; file_key: string }>;
  });

  let requeued = 0;
  let stillLocked = 0;
  const jobOpts = { attempts: 1, removeOnComplete: true, removeOnFail: { age: 3600 } } as const;

  for (const r of rows) {
    let buf: Buffer;
    try {
      buf = await getObjectBytes(r.file_key);
    } catch {
      continue; // object already purged — nothing to retry
    }
    // Only ZIPs carry a password; link-downloaded CSVs arrive in the clear.
    const isZip = buf.length > 1 && buf[0] === 0x50 && buf[1] === 0x4b;
    if (isZip && !(await openWithAnyPassword(buf, passwords)).ok) {
      stillLocked++;
      continue;
    }

    // The worker treats `rejected`/`failed` as terminal and short-circuits, so
    // the row MUST be reset before the job is queued or it will be dropped.
    await withTenant(job.tenantId, async (tx) => {
      await tx.execute(sql`
        UPDATE rta_file_imports
        SET status = 'uploaded', parsed_at = NULL, errors = NULL,
            remarks = 'Re-queued after a new mailback password was saved'
        WHERE id = ${r.id}::uuid`);
    });

    if (RICH_KINDS.has(r.kind)) {
      await Q.rtaImport().add(
        "rich-import",
        {
          mode: "rich", importId: r.id, tenantId: job.tenantId, key: r.file_key,
          filename: r.file_name, passwords, rta: job.source, reportType: "",
          dryRun: false, assignToMe: false, userId: SYSTEM_USER, roles: [],
        },
        jobOpts
      );
    } else {
      await Q.rtaImport().add(
        "import",
        {
          importId: r.id, tenantId: job.tenantId, source: job.source, kind: r.kind,
          key: r.file_key, filename: r.file_name, passwords,
          userId: SYSTEM_USER, roles: [],
        },
        jobOpts
      );
    }
    requeued++;
  }

  console.log(
    `[rta-import] rescan ${job.tenantId}/${job.source}: ${requeued} re-queued, ${stillLocked} still locked, ${rows.length} scanned`
  );
  return { requeued, stillLocked, scanned: rows.length };
}

/** Queue a rescan of a firm's rejected archives for one registrar. */
export async function enqueueRejectedRescan(tenantId: string, source: RtaSource): Promise<void> {
  await Q.rtaImport().add(
    "rescan",
    { mode: "rescan", tenantId, source } satisfies RtaRescanJob,
    { attempts: 1, removeOnComplete: true, removeOnFail: { age: 3600 } }
  );
}

export function startRtaImportWorker() {
  // BullMQ workers need their own blocking connection (maxRetriesPerRequest:null).
  const connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: null,
  });

  const worker = new Worker(
    "rta.import",
    async (job) => {
      const localKey = (job.data as any)?.key as string | undefined;
      // Idempotency: if a worker restart left this job 'stalled' and BullMQ is
      // re-running it after the import already finished, do NOT reprocess — that
      // re-reads the already-deleted S3 object ("specified key does not exist")
      // and could clobber a completed import. Just clean up and return.
      if (await importAlreadyFinished(job.data as any)) {
        if (localKey) await deleteObject(localKey).catch(() => {});
        return;
      }
      try {
        // A rescan queues OTHER jobs rather than importing anything itself, so
        // it must be dispatched before the import paths (it carries no key).
        if ((job.data as any)?.mode === "rescan") {
          return await runRejectedRescanJob(job.data as RtaRescanJob);
        }
        // Rich master/holdings import returns its summary (UI polls for it);
        // the feed import updates the rta_file_imports row and returns nothing.
        if ((job.data as any)?.mode === "rich") {
          // Forward live progress to BullMQ so /api/rta/import-status (and the UI
          // bar + ETA) can read it. updateProgress is fire-and-forget.
          return await runRichImportJob(job.data as RichImportJob, (p) => {
            void job.updateProgress(p as any);
          });
        }
        await runRtaImportJob(job.data as RtaImportJob);
      } finally {
        // Purge the source file ONLY once it has actually been imported.
        //
        // This used to purge on success OR failure, which quietly made every
        // failure permanent: the commonest failure is a wrong ZIP password, and
        // deleting the file means fixing the password can never recover it — the
        // firm has to re-request the report from the registrar. Keeping the file
        // on failure makes a credential fix a genuine retry.
        //
        // Status is re-read rather than inferred from "didn't throw", because the
        // import records its own failure in the row and returns normally.
        if (localKey && (await importSucceeded(job.data as any))) {
          await deleteObject(localKey).catch(() => {});
        }
      }
    },
    { connection, concurrency: 1 } // one heavy parse at a time — bounds peak memory
  );

  worker.on("failed", (job, err) => {
    captureError("[rta-import] job failed", err, { importId: (job?.data as RtaImportJob)?.importId });
  });

  // Stuck-row reaper, every 5 minutes.
  const reapHandle = setInterval(async () => {
    try {
      const n = await reapStuckParsing();
      if (n > 0) console.log(`[rta-import] reaped ${n} stuck parsing row(s)`);
    } catch (err) {
      captureError("[rta-import] reaper error", err);
    }
  }, 5 * 60 * 1000);
  reapHandle.unref?.();

  console.log("[rta-import] worker started (concurrency=1, reaper=5m)");
  return () => {
    clearInterval(reapHandle);
    void worker.close();
    void connection.quit();
  };
}
