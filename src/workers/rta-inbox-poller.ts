/**
 * RTA mailback inbox poller.
 *
 * Polls ONE catch-all mailbox (RTA_INBOX_*) that every MFD auto-forwards their
 * daily CAMS/KFintech mailback email to. For each new message:
 *
 *   1. Resolve the tenant from the recipient address (rta_forward_addresses).
 *   2. Auto-capture any Gmail/Outlook forwarding-confirmation code for the UI.
 *   3. Classify each attachment by report-code + sender → (source, kind).
 *   4. Push the (still password-protected) attachment to S3 and enqueue the
 *      SAME rta.import job the manual upload route uses — which unzips (with the
 *      firm's stored CAMS/KFintech password), auto-detects, imports, and dedupes.
 *
 * Nothing here parses the file: it reuses the existing worker end-to-end. The
 * only new work is the inbound-email → attachment → S3 → enqueue bridge.
 *
 * Idempotency: messages are marked \Seen after handling; attachments dedupe on
 * sha256 vs prior rta_file_imports rows; unroutable mail is quarantined, never
 * dropped.
 */

import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { withSystem, withTenant } from "@/db/client";
import {
  processUnseenMailback,
  deleteMessagesByMessageId,
  type ImapConfig,
  type InboundRawMessage,
  type InboundAttachment,
} from "@/lib/comms/imap";
import { describeMailError } from "@/lib/comms/connection-error";
import { putObject } from "@/lib/storage/s3";
import { Q } from "./queues";
import {
  classifyMailback,
  classifyMailbackFromText,
  isImportableAttachment,
  type MailbackClass,
} from "@/lib/rta/classify-mailback";
import { extractRtaDownloadLinks, fetchRtaDownload } from "@/lib/rta/mailback-download";
import {
  getMailbackPasswords,
  passwordCandidates,
  resolveTenantByAddresses,
  resolveTenantBySenders,
  stampReceived,
  recordForwardingConfirmation,
  type MailbackPasswords,
} from "@/lib/rta/mailback-config";
import { loadRtaInboxConfig } from "@/lib/rta/inbox-config";
import { captureError } from "@/lib/observability/capture";

// Background imports have no human uploader. A stable sentinel enables the
// worker's stalled-job idempotency guard (importAlreadyFinished needs a truthy
// userId) while `uploaded_by` on the row stays NULL. It only sets a Postgres
// session var; no FK, and RLS scopes by tenant_id, not user.
const SYSTEM_USER = "00000000-0000-0000-0000-000000000000";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Detect a Gmail/Outlook forwarding-confirmation mail and pull out what we need:
 * the numeric code (when there is one), the confirm link, and — crucially — the
 * mailbox that REQUESTED the forward.
 *
 * That requester is the only firm-identifying data in the message: Google sends
 * this mail itself, so the From is forwarding-noreply@google.com and there is no
 * X-Forwarded-For to match on. Without pulling the requester out of the body, a
 * confirmation sent to the SHARED rta@ address can't be attributed to any firm.
 */
function detectForwardingConfirmation(
  msg: InboundRawMessage
): { code: string | null; url: string | null; requester: string | null } | null {
  const from = (msg.from ?? "").toLowerCase();
  const subj = msg.subject ?? "";
  const body = msg.text ?? "";
  const blob = `${subj}\n${body}`;
  const isForwarding =
    from.includes("forwarding-noreply@google.com") ||
    (/forward/i.test(subj) && /confirm|verif/i.test(blob)) ||
    (from.includes("microsoft") && /forward/i.test(blob));
  if (!isForwarding) return null;

  // Strip URLs BEFORE scanning for a code — Gmail's link-only mail ends with
  // "answer.py?answer=184973", and a naive \d{6,10} happily returns that
  // support-article id as if it were the confirmation code.
  const deUrled = blob.replace(/https?:\/\/\S+/gi, " ");
  const code =
    // Prefer a number explicitly labelled as the code.
    deUrled.match(/(?:confirmation\s+code|code)\D{0,20}(\d{6,10})/i)?.[1] ??
    deUrled.match(/\b(\d{6,10})\b/)?.[1] ??
    null;

  const url =
    (blob.match(/https?:\/\/\S*(?:\/vf-|confirm|verif|forward)\S*/i)?.[0] ?? body.match(/https?:\/\/\S+/i)?.[0] ?? null)
      ?.replace(/[)\].,'">]+$/, "") ?? null;

  // "<addr> has requested to automatically forward mail to your email address"
  // (body), or the subject "… Receive Mail from <addr>".
  const requester =
    body.match(/([\w.+-]+@[\w.-]+\.\w{2,})\s+has requested to automatically forward/i)?.[1] ??
    subj.match(/receive mail from\s+([\w.+-]+@[\w.-]+\.\w{2,})/i)?.[1] ??
    null;

  return { code, url, requester: requester?.toLowerCase() ?? null };
}

/** Per-attachment verdict recorded on the inbound-mail log row. */
type AttachmentLog = {
  filename: string;
  size: number;
  source: string | null;
  kind: string | null;
  outcome: "queued" | "duplicate" | "unrecognised" | "error";
  importId?: string | null;
  reason?: string | null;
};

type InboundOutcome = "imported" | "duplicate" | "confirmation" | "no_attachment" | "unroutable" | "error";

/** Body text we keep for the admin log — enough to identify the mail, not the lot. */
const BODY_SNIPPET_MAX = 2000;

/**
 * Record EVERY message the poller touches — routed or not — so "did my forward
 * arrive?" is answerable from SSIT Admin → Inbound Mail instead of the worker
 * logs. Best-effort: a logging failure must never stop an import.
 *
 * Upserts on message_id (globally unique per RFC 5322), so a message reprocessed
 * after a crash-before-\Seen refreshes its row rather than duplicating it.
 */
async function logInbound(
  msg: InboundRawMessage,
  fields: {
    tenantId?: string | null;
    forwardAddressId?: string | null;
    toAddress?: string | null;
    outcome: InboundOutcome;
    reason?: string | null;
    attachments?: AttachmentLog[];
    queued?: number;
    duplicates?: number;
  }
): Promise<void> {
  try {
    const atts = fields.attachments ?? [];
    await withSystem(async (tx) => {
      await tx.execute(sql`
        INSERT INTO rta_inbound_messages (
          tenant_id, forward_address_id, message_id, from_address, from_name,
          to_address, recipients, subject, body_snippet, received_at,
          outcome, reason, attachment_count, queued_count, duplicate_count, attachments
        ) VALUES (
          ${fields.tenantId ?? null}, ${fields.forwardAddressId ?? null},
          ${msg.messageId ?? null}, ${msg.from ?? null}, ${msg.fromName ?? null},
          ${fields.toAddress ?? msg.recipients[0] ?? null},
          ${JSON.stringify(msg.recipients ?? [])}::jsonb,
          ${msg.subject ?? null}, ${(msg.text ?? "").slice(0, BODY_SNIPPET_MAX) || null},
          ${msg.date ?? null}, ${fields.outcome}, ${fields.reason ?? null},
          ${msg.attachments.length}, ${fields.queued ?? 0}, ${fields.duplicates ?? 0},
          ${JSON.stringify(atts)}::jsonb
        )
        ON CONFLICT (message_id) WHERE message_id IS NOT NULL DO UPDATE SET
          tenant_id = EXCLUDED.tenant_id,
          forward_address_id = EXCLUDED.forward_address_id,
          outcome = EXCLUDED.outcome,
          reason = EXCLUDED.reason,
          attachment_count = EXCLUDED.attachment_count,
          queued_count = EXCLUDED.queued_count,
          duplicate_count = EXCLUDED.duplicate_count,
          attachments = EXCLUDED.attachments
      `);
    });
  } catch (e) {
    captureError("[rta-inbox] inbound log insert failed", e, { outcome: fields.outcome });
  }
}

async function quarantine(msg: InboundRawMessage, reason: string): Promise<void> {
  await logInbound(msg, { outcome: "unroutable", reason });
  console.warn(`[rta-inbox] quarantined mail from ${msg.from ?? "?"} (${reason})`);
}

/** Upload one attachment to S3 + enqueue the matching rta.import job. */
async function ingestAttachment(
  tenantId: string,
  msg: InboundRawMessage,
  att: InboundAttachment,
  cls: MailbackClass,
  pw: MailbackPasswords
): Promise<{ status: "queued" | "duplicate"; importId: string | null }> {
  const checksum = createHash("sha256").update(att.content).digest("hex");

  // Guard only against a file that is STILL IN FLIGHT (uploaded/parsing) for this
  // tenant/kind — prevents an overlapping poll from double-enqueuing the same job.
  // A previously completed/partial/failed import is deliberately NOT skipped: the
  // downstream import upserts (overwrites folios/transactions in place), so every
  // re-forward refreshes the book to the LATEST data. Idempotency-by-skip would
  // stop a re-sent file from ever refreshing, which is not what MFDs want.
  const dup = await withTenant(tenantId, async (tx) =>
    tx.execute(sql`
      SELECT id FROM rta_file_imports
      WHERE tenant_id = ${tenantId}::uuid AND source = ${cls.source} AND kind = ${cls.kind}
        AND file_checksum = ${checksum}
        AND status IN ('parsing', 'uploaded')
      LIMIT 1
    `)
  );
  if (dup.rows.length) {
    console.log(`[rta-inbox] ${tenantId}: '${att.filename}' already in flight — skipped (duplicate)`);
    return { status: "duplicate", importId: (dup.rows[0] as any).id as string };
  }

  const safe = att.filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  const key = `tenants/${tenantId}/rta/${Date.now()}-${safe}`;
  await putObject(key, att.content, att.contentType || "application/octet-stream");

  // Every password this firm has saved for the registrar, tried in order until
  // one opens the archive — a firm with more than one ARN can have more than
  // one mailback subscription (and password) per registrar.
  const passwords = passwordCandidates(pw, cls.source).map((e) => e.password);

  const importId = await withTenant(tenantId, async (tx) => {
    const r = await tx.execute(sql`
      INSERT INTO rta_file_imports (
        tenant_id, source, kind, period_start, period_end,
        file_name, file_key, file_size_bytes, file_checksum, status, remarks
      ) VALUES (
        ${tenantId}::uuid, ${cls.source}, ${cls.kind}, ${today()}::date, ${today()}::date,
        ${att.filename}, ${key}, ${att.size}, ${checksum}, 'uploaded',
        ${`Auto-imported from forwarded email (${msg.from ?? "unknown sender"})`}
      )
      RETURNING id
    `);
    return (r.rows[0] as any).id as string;
  });

  const jobOpts = { attempts: 1, removeOnComplete: true, removeOnFail: { age: 3600 } } as const;
  if (cls.isRich) {
    // Master / holdings → the rich engine that builds the client book.
    await Q.rtaImport().add(
      "rich-import",
      {
        mode: "rich",
        importId,
        tenantId,
        key,
        filename: att.filename,
        passwords,
        rta: cls.source,
        reportType: "",
        dryRun: false,
        assignToMe: false,
        userId: SYSTEM_USER,
        roles: [],
      },
      jobOpts
    );
  } else {
    // Daily feed / brokerage / AUM / SIP-rejection / mandate → feed processor.
    await Q.rtaImport().add(
      "import",
      {
        importId,
        tenantId,
        source: cls.source,
        kind: cls.kind,
        key,
        filename: att.filename,
        passwords,
        userId: SYSTEM_USER,
        roles: [],
      },
      jobOpts
    );
  }
  console.log(`[rta-inbox] ${tenantId}: queued ${cls.label} '${att.filename}' (${att.size}b) → ${importId}`);
  return { status: "queued", importId };
}

async function handleMessage(msg: InboundRawMessage): Promise<void> {
  // Detected up-front: a Gmail confirmation is the one message whose firm
  // identity lives in the BODY rather than in any header (see below).
  const confirm = detectForwardingConfirmation(msg);

  // 1. Route to a tenant. Three paths, strongest first:
  //    a) the per-firm alias rta-<token>@<domain> the mail was addressed to,
  //    b) the mailbox it was forwarded FROM — what makes the shared
  //       rta@<domain> address usable at all (migration 0193), and
  //    c) for a Gmail forwarding-confirmation ONLY, the mailbox that requested
  //       the forward. Google sends that mail itself (From is
  //       forwarding-noreply@google.com, no X-Forwarded-For), so without this
  //       a confirmation for the shared address can never reach its firm.
  //    (b)/(c) are only consulted when (a) misses, so an alias can never be
  //    overridden by a spoofable body or header.
  const resolved = await withSystem(async (tx) => {
    const byAlias = await resolveTenantByAddresses(tx, msg.recipients);
    if (byAlias) return { row: byAlias, via: "alias" as const, ambiguous: false };

    const bySender = await resolveTenantBySenders(tx, msg.senderCandidates);
    if (bySender.row) return { row: bySender.row, via: "sender" as const, ambiguous: false };

    if (confirm?.requester) {
      const byReq = await resolveTenantBySenders(tx, [confirm.requester]);
      if (byReq.row) return { row: byReq.row, via: "confirm-requester" as const, ambiguous: false };
      return { row: null, via: "confirm-requester" as const, ambiguous: byReq.ambiguous };
    }
    return { row: null, via: "sender" as const, ambiguous: bySender.ambiguous };
  });

  const match = resolved.row;
  if (!match) {
    // An unattributable CONFIRMATION is still logged as a confirmation, not
    // buried in the unroutable pile — it carries the code/link the operator
    // needs, and the fix (register the requesting mailbox) is actionable.
    if (confirm) {
      await logInbound(msg, {
        outcome: "confirmation",
        reason:
          `Forwarding confirmation from ${confirm.requester ?? "an unknown mailbox"} — could NOT be matched to a firm. ` +
          `Register that mailbox on the firm's RTA Mailback card, then re-send the confirmation.` +
          (confirm.code ? ` Code: ${confirm.code}.` : " Use the confirmation link in the body below."),
      });
      console.warn(
        `[rta-inbox] forwarding confirmation from ${confirm.requester ?? "?"} not attributable to a firm — see Inbound Mail`
      );
      return;
    }
    await quarantine(
      msg,
      resolved.ambiguous
        ? "sender mailbox is registered by more than one firm — not routed (register a unique mailbox, or use the firm's own rta-<token>@ address)"
        : "no matching forwarding address, and the sending mailbox isn't registered by any firm"
    );
    return;
  }
  if (resolved.via === "confirm-requester") {
    console.log(`[rta-inbox] ${match.tenantId}: forwarding confirmation matched via requesting mailbox`);
  }
  if (resolved.via === "sender") {
    console.log(`[rta-inbox] ${match.tenantId}: routed by registered sender (shared address)`);
  }
  const tenantId = match.tenantId;
  // Everything from here on is attributable to a firm, so any failure is logged
  // against that firm rather than vanishing into the worker log.
  const logBase = { tenantId, forwardAddressId: match.id, toAddress: match.address ?? null };

  try {
    // 2. Stamp receipt + capture any forwarding-confirmation code for the UI.
    await withTenant(tenantId, async (tx) => {
      await stampReceived(tx, match.id);
      if (confirm) await recordForwardingConfirmation(tx, match.id, confirm.code, confirm.url);
    });
    // A pure Gmail/Outlook verification email carries no importable data.
    if (confirm && msg.attachments.length === 0) {
      console.log(`[rta-inbox] ${tenantId}: captured forwarding confirmation${confirm.code ? ` (code ${confirm.code})` : ""}`);
      await logInbound(msg, {
        ...logBase,
        outcome: "confirmation",
        reason: confirm.code ? `Forwarding confirmation code ${confirm.code}` : "Forwarding confirmation",
      });
      return;
    }

    // 3. Load the firm's CAMS + KFintech ZIP passwords once.
    const pw = await withTenant(tenantId, async (tx) => getMailbackPasswords(tx, tenantId));

    // 4. Ingest each recognised attachment. Track outcomes so we only quarantine
    //    mail we genuinely couldn't use — a recognised-but-already-imported file
    //    (dedup) is a legitimate no-op, NOT junk to quarantine.
    let queued = 0;
    let duplicates = 0;
    let recognised = 0;
    const attLogs: AttachmentLog[] = [];

    for (const att of msg.attachments) {
      if (!isImportableAttachment(att.filename)) continue;
      const cls = classifyMailback(att.filename, msg.from);
      if (!cls) {
        console.warn(`[rta-inbox] ${tenantId}: unrecognised attachment '${att.filename}' from ${msg.from ?? "?"} — skipped`);
        attLogs.push({
          filename: att.filename,
          size: att.size,
          source: null,
          kind: null,
          outcome: "unrecognised",
          reason: "Filename carries no recognised CAMS/KFintech report code",
        });
        continue;
      }
      recognised++;
      try {
        const res = await ingestAttachment(tenantId, msg, att, cls, pw);
        if (res.status === "queued") queued++;
        else duplicates++;
        attLogs.push({
          filename: att.filename,
          size: att.size,
          source: cls.source,
          kind: cls.kind,
          outcome: res.status,
          importId: res.importId,
          reason: res.status === "duplicate" ? "Same file already being imported" : null,
        });
      } catch (e) {
        captureError("[rta-inbox] attachment ingest failed", e, { tenantId, filename: att.filename });
        attLogs.push({
          filename: att.filename,
          size: att.size,
          source: cls.source,
          kind: cls.kind,
          outcome: "error",
          reason: (e as Error)?.message ?? "ingest failed",
        });
      }
    }

    // 5. LINK-delivered reports. Above a certain size neither registrar attaches
    //    the ZIP — CAMS mails a `DownloadURL` (Request Status: Link) and
    //    KFintech a "Click Here" anchor. Those mails have zero attachments, so
    //    without this the biggest reports (the daily feeds) never import.
    //    Only attempted when no attachment already produced an import.
    if (queued === 0) {
      const links = extractRtaDownloadLinks(msg.text, msg.html);
      for (const link of links.slice(0, 3)) {
        const dl = await fetchRtaDownload(link);
        if (!dl.ok) {
          console.warn(`[rta-inbox] ${tenantId}: download skipped (${dl.reason}) — ${link.slice(0, 80)}`);
          attLogs.push({ filename: link.slice(0, 200), size: 0, source: null, kind: null, outcome: "error", reason: dl.reason });
          continue;
        }
        // The downloaded name is usually an opaque token that still ends in the
        // report code (…219432120R2.zip). When it doesn't classify, fall back to
        // the mail text, which states the report explicitly ("Report No: MFSD311").
        const cls =
          classifyMailback(dl.file.filename, msg.from) ??
          classifyMailbackFromText(msg.subject, `${msg.text ?? ""}\n${msg.html ?? ""}`, msg.from);
        if (!cls) {
          attLogs.push({
            filename: dl.file.filename,
            size: dl.file.size,
            source: null,
            kind: null,
            outcome: "unrecognised",
            reason: "Downloaded file, but neither its name nor the mail names a known report code",
          });
          continue;
        }
        recognised++;
        try {
          const res = await ingestAttachment(tenantId, msg, dl.file, cls, pw);
          if (res.status === "queued") queued++;
          else duplicates++;
          attLogs.push({
            filename: dl.file.filename,
            size: dl.file.size,
            source: cls.source,
            kind: cls.kind,
            outcome: res.status,
            importId: res.importId,
            reason: `Downloaded from ${new URL(dl.file.url).hostname}`,
          });
          break; // one report per mail — stop at the first success
        } catch (e) {
          captureError("[rta-inbox] link ingest failed", e, { tenantId, url: link });
          attLogs.push({
            filename: dl.file.filename,
            size: dl.file.size,
            source: cls.source,
            kind: cls.kind,
            outcome: "error",
            reason: (e as Error)?.message ?? "ingest failed",
          });
        }
      }
    }

    const logTail = { ...logBase, attachments: attLogs, queued, duplicates };

    if (queued > 0) {
      await logInbound(msg, { ...logTail, outcome: "imported" });
      return; // something imported — done
    }
    if (recognised > 0) {
      // Recognised but nothing new to import (all duplicates of prior imports).
      // A no-op, not junk — do NOT quarantine.
      console.log(`[rta-inbox] ${tenantId}: ${duplicates} attachment(s) already imported — no new import (no-op)`);
      await logInbound(msg, { ...logTail, outcome: "duplicate", reason: "Already imported — no new data" });
      return;
    }
    // Nothing recognised at all (and not a forwarding-confirmation) → quarantine.
    if (!confirm) {
      await logInbound(msg, {
        ...logTail,
        outcome: "no_attachment",
        reason: msg.attachments.length
          ? "No attachment matched a known CAMS/KFintech report code"
          : "Mail had no attachments, and no downloadable report link could be used (see per-link reasons)",
      });
      console.warn(`[rta-inbox] ${tenantId}: no importable RTA attachment recognised`);
    } else {
      await logInbound(msg, { ...logTail, outcome: "confirmation", reason: "Forwarding confirmation" });
    }
  } catch (e) {
    // Route-succeeded-but-processing-failed: record it against the firm so the
    // failure is visible in the admin log, then rethrow for the usual capture.
    await logInbound(msg, { ...logBase, outcome: "error", reason: (e as Error)?.message ?? "handler failed" });
    throw e;
  }
}

/**
 * Cleanup sweep — delete forwarded mail from the catch-all once it has been
 * imported, so the mailbox doesn't grow without bound.
 *
 * Safe because the attachment bytes were pushed to S3 BEFORE the import was
 * queued, and rta_inbound_messages keeps the audit trail (sender, subject, body
 * snippet, per-attachment verdict) after the mail itself is gone.
 *
 * A message is only eligible when EVERY attachment it queued has an import row
 * that actually finished (`completed`/`partial`). A failed import — wrong ZIP
 * password being the common case — therefore KEEPS its mail, so fixing the
 * password and re-running is still possible. Nothing else is ever touched:
 * unroutable, quarantined and errored mail stay put for a human to look at.
 */
async function sweepImportedMail(cfg: ImapConfig, retentionDays: number): Promise<number> {
  const rows = await withSystem(async (tx) => {
    const r = await tx.execute(sql`
      SELECT m.id, m.message_id
      FROM rta_inbound_messages m
      WHERE m.outcome = 'imported'
        AND m.mail_deleted_at IS NULL
        AND m.message_id IS NOT NULL
        AND m.created_at < now() - (${String(retentionDays)} || ' days')::interval
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(m.attachments) a
          WHERE a->>'outcome' = 'queued'
            AND COALESCE(
              (SELECT fi.status FROM rta_file_imports fi WHERE fi.id::text = a->>'importId'),
              'missing'
            ) NOT IN ('completed', 'partial')
        )
      ORDER BY m.created_at
      LIMIT 200
    `);
    return r.rows as unknown as Array<{ id: string; message_id: string }>;
  });
  if (!rows.length) return 0;

  const { deleted } = await deleteMessagesByMessageId(cfg, rows.map((r) => r.message_id));
  if (!deleted.length) return 0;

  // Stamp only what actually went, so a message that failed to delete is retried
  // next sweep rather than being silently marked clean.
  const byMid = new Map(rows.map((r) => [r.message_id, r.id]));
  const ids = deleted.map((mid) => byMid.get(mid)).filter(Boolean) as string[];
  await withSystem(async (tx) => {
    await tx.execute(sql`
      UPDATE rta_inbound_messages SET mail_deleted_at = now()
      WHERE id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})
    `);
  });
  return deleted.length;
}

export async function pollRtaInboxOnce(): Promise<{ processed: number; configured: boolean; error?: string }> {
  try {
    const rc = await loadRtaInboxConfig();
    if (!rc.configured) {
      return { processed: 0, configured: false, error: "RTA mailbox credentials are not configured in Admin settings." };
    }
    const cfg: ImapConfig = { host: rc.host!, port: rc.port, secure: rc.secure, user: rc.user!, pass: rc.pass! };
    const { processed } = await processUnseenMailback(cfg, handleMessage);
    return { processed, configured: true };
  } catch (e: any) {
    const errDesc = describeMailError(e, "imap");
    return { processed: 0, configured: true, error: errDesc || e.message };
  }
}

export function startRtaInboxPollerWorker() {
  const interval = Number(process.env.RTA_INBOX_POLLER_INTERVAL_MS ?? 120_000);
  const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // hourly
  let running = false;
  let warnedIdle = false;
  let lastSweep = 0;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const rc = await loadRtaInboxConfig();
      if (!rc.configured) {
        if (!warnedIdle) {
          console.log("[rta-inbox] inbox not configured (SSIT Admin → RTA Mailbox, or RTA_INBOX_* env) — poller idle");
          warnedIdle = true;
        }
        return;
      }
      warnedIdle = false;
      const cfg: ImapConfig = { host: rc.host!, port: rc.port, secure: rc.secure, user: rc.user!, pass: rc.pass! };
      const { processed } = await processUnseenMailback(cfg, handleMessage);
      if (processed) console.log(`[rta-inbox] processed ${processed} message(s) (domain=${rc.domain})`);

      if (rc.deleteAfterImport && Date.now() - lastSweep > SWEEP_INTERVAL_MS) {
        lastSweep = Date.now();
        try {
          const n = await sweepImportedMail(cfg, rc.retentionDays);
          if (n) console.log(`[rta-inbox] cleanup: deleted ${n} imported mail(s) older than ${rc.retentionDays}d`);
        } catch (e) {
          captureError("[rta-inbox] cleanup sweep failed", e);
        }
      }
    } catch (e) {
      console.error(`[rta-inbox] poll failed: ${describeMailError(e, "imap")} (raw: ${(e as Error).message})`);
    } finally {
      running = false;
    }
  };

  const handle = setInterval(tick, interval);
  handle.unref?.();
  console.log(`[rta-inbox] mailback poller started (interval=${interval}ms; config from SSIT Admin)`);
  return () => clearInterval(handle);
}

