/**
 * IMAP mailbox helpers. `verifyImap` powers the "Test connection" button in
 * Settings → Email so an MFD can confirm their inbox credentials before saving.
 *
 * The inbound *sync* worker (pulling client replies into the unified inbox) is a
 * separate, focused build — this file intentionally stays at connection-test
 * scope for now.
 */

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { describeMailError } from "./connection-error";

export interface ImapConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  /** XOAUTH2 access token (Gmail / M365 connected over OAuth). Wins over `pass`. */
  accessToken?: string;
}

/** imapflow auth block — XOAUTH2 when an access token is present, else password. */
function imapAuth(cfg: ImapConfig): { user: string; pass?: string; accessToken?: string } {
  return cfg.accessToken
    ? { user: cfg.user, accessToken: cfg.accessToken }
    : { user: cfg.user, pass: cfg.pass };
}

export interface InboundEmail {
  uid: number;
  messageId?: string;
  /** RFC 5322 threading headers — link a reply back to our outbound message. */
  inReplyTo?: string;
  references?: string;
  from?: string;
  fromName?: string;
  subject?: string;
  text?: string;
  html?: string;
  date?: Date;
}

/** A decoded attachment (RTA mailback ZIP / spreadsheet) from an inbound email. */
export interface InboundAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
  size: number;
}

/**
 * A raw inbound message with everything the RTA-mailback ingest needs: the FROM,
 * every recipient candidate (to route a forwarded mail to a tenant), and the
 * attachment bytes. Distinct from InboundEmail (which is threading-focused and
 * drops attachments).
 */
export interface InboundRawMessage {
  uid: number;
  messageId?: string;
  from?: string;
  fromName?: string;
  subject?: string;
  text?: string;
  /**
   * HTML body. RTA mailback mails increasingly deliver the report as a DOWNLOAD
   * LINK rather than an attachment (KFintech hides it behind a "Click Here"
   * anchor), so the href is only recoverable from the HTML part.
   */
  html?: string;
  date?: Date;
  /** All addresses the mail was delivered to (To/Cc + Delivered-To/X-*-To). */
  recipients: string[];
  /**
   * Addresses that identify WHO forwarded this mail — the firm's own mailbox,
   * not the RTA's. Used to route mail sent to the shared rta@<domain> address
   * (see resolveTenantBySenders). Gmail stamps the forwarding mailbox into
   * X-Forwarded-For; a manual forward puts it in From/Return-Path.
   */
  senderCandidates: string[];
  attachments: InboundAttachment[];
}

const EMAIL_RE = /[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/gi;
/** Raw headers where auto-forwarders (Gmail/Outlook/Postfix) stamp the RCPT TO. */
const RECIPIENT_HEADER_KEYS = new Set([
  "delivered-to",
  "x-delivered-to",
  "x-original-to",
  "x-forwarded-to",
  "envelope-to",
  "x-envelope-to",
  "resent-to",
]);

/**
 * Headers that carry the identity of the mailbox that FORWARDED the mail.
 *
 * Gmail writes `X-Forwarded-For: <forwarding-mailbox> <destination>`; Postfix and
 * most MTAs set Return-Path to the envelope sender. `Resent-From` covers clients
 * that do a true resend rather than an inline forward.
 */
const FORWARDER_HEADER_KEYS = new Set(["x-forwarded-for", "return-path", "resent-from", "sender"]);

/**
 * Who forwarded this mail (as opposed to who originally sent it). On an
 * auto-forwarded CAMS/KFintech mailback the `From` stays the RTA, so the firm's
 * own address only appears in the forwarding headers — that's what makes the
 * shared rta@<domain> address routable at all.
 *
 * The visible `From` is included last: on a MANUAL forward it IS the firm.
 */
function collectSenderCandidates(parsed: any, fromAddr?: string): string[] {
  const out = new Set<string>();
  for (const line of parsed?.headerLines ?? []) {
    const key = String(line?.key ?? "").toLowerCase();
    if (!FORWARDER_HEADER_KEYS.has(key)) continue;
    const matches = String(line?.line ?? "").match(EMAIL_RE);
    if (matches) for (const m of matches) out.add(m.toLowerCase());
  }
  if (fromAddr) out.add(fromAddr.toLowerCase().trim());
  return [...out];
}

function collectRecipients(parsed: any, envelope: any): string[] {
  const out = new Set<string>();
  const add = (v: any) => {
    const a = typeof v === "string" ? v : v?.address;
    if (a) out.add(String(a).toLowerCase().trim());
  };
  for (const a of envelope?.to ?? []) add(a);
  for (const a of envelope?.cc ?? []) add(a);
  for (const grp of [parsed?.to, parsed?.cc, parsed?.bcc]) {
    for (const v of grp?.value ?? []) add(v);
  }
  // The visible To on a forwarded mail is usually the MFD's OWN address — the
  // address WE were addressed at lives in the Delivered-To / X-*-To headers.
  for (const line of parsed?.headerLines ?? []) {
    const key = String(line?.key ?? "").toLowerCase();
    if (!RECIPIENT_HEADER_KEYS.has(key)) continue;
    const matches = String(line?.line ?? "").match(EMAIL_RE);
    if (matches) for (const m of matches) out.add(m.toLowerCase());
  }
  return [...out];
}

/**
 * Poll the INBOX for UNSEEN messages and hand each (with attachments + recipient
 * candidates) to `handler`. Each message is marked \Seen after the handler runs
 * — success OR failure — so a poison message can't loop every tick (the caller's
 * dedupe + quarantine guarantee correctness). Bounded by `limit` per call.
 *
 * Uses a dedicated ingest mailbox (we own it), so marking \Seen as the
 * high-water is safe — unlike imapFetchSince, which polls the MFD's own mailbox
 * and must not touch their flags.
 */
export async function processUnseenMailback(
  cfg: ImapConfig,
  handler: (msg: InboundRawMessage) => Promise<void>,
  limit = 25
): Promise<{ processed: number }> {
  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: imapAuth(cfg),
    logger: false,
    socketTimeout: 60_000,
    greetingTimeout: 10_000,
  });
  client.on("error", () => {});
  let processed = 0;
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const uids = (await client.search({ seen: false }, { uid: true })) || [];
      if (uids.length) {
        // imapflow accepts a comma-joined UID list as the fetch range.
        const take = uids.slice(0, limit).join(",");
        const msgs: InboundRawMessage[] = [];
        for await (const m of client.fetch(take, { uid: true, source: true, envelope: true }, { uid: true })) {
          if (!m.uid || !m.source) continue;
          const parsed = await simpleParser(m.source as Buffer);
          const fromAddr = parsed.from?.value?.[0];
          const attachments: InboundAttachment[] = (parsed.attachments ?? [])
            .filter((a: any) => a?.filename && Buffer.isBuffer(a.content))
            .map((a: any) => ({
              filename: String(a.filename),
              contentType: String(a.contentType ?? "application/octet-stream"),
              content: a.content as Buffer,
              size: (a.content as Buffer).length,
            }));
          msgs.push({
            uid: m.uid,
            messageId: parsed.messageId ?? undefined,
            from: fromAddr?.address,
            fromName: fromAddr?.name,
            subject: parsed.subject,
            text: parsed.text,
            html: typeof parsed.html === "string" ? parsed.html : undefined,
            date: parsed.date,
            recipients: collectRecipients(parsed, m.envelope),
            senderCandidates: collectSenderCandidates(parsed, fromAddr?.address),
            attachments,
          });
        }
        for (const msg of msgs) {
          try {
            await handler(msg);
          } catch (e) {
            console.error(`[rta-inbox] handler error uid=${msg.uid}: ${(e as Error).message}`);
          }
          try {
            await client.messageFlagsAdd(String(msg.uid), ["\\Seen"], { uid: true });
          } catch {
            /* best-effort — a re-read is deduped by checksum */
          }
          processed++;
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
  return { processed };
}

/**
 * Delete messages from the ingest mailbox by their RFC 5322 Message-ID.
 *
 * Matching on Message-ID rather than a stored UID is deliberate: UIDs are only
 * meaningful alongside the mailbox's UIDVALIDITY, and if the server ever resets
 * it, a stale UID would point at a DIFFERENT message — i.e. we'd delete the
 * wrong mail. Message-ID is globally unique and stable, so a miss is a harmless
 * no-op instead of a wrong deletion.
 *
 * Returns the Message-IDs actually deleted, so the caller only records the ones
 * that really went (a message already removed by hand stays unrecorded and is
 * simply skipped next sweep).
 */
export async function deleteMessagesByMessageId(
  cfg: ImapConfig,
  messageIds: string[]
): Promise<{ deleted: string[]; notFound: string[] }> {
  const deleted: string[] = [];
  const notFound: string[] = [];
  if (!messageIds.length) return { deleted, notFound };

  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: imapAuth(cfg),
    logger: false,
    socketTimeout: 60_000,
    greetingTimeout: 10_000,
  });
  client.on("error", () => {});
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      for (const mid of messageIds) {
        try {
          // header search is exact-match on the Message-ID header value.
          const uids = (await client.search({ header: { "message-id": mid } }, { uid: true })) || [];
          if (!uids.length) {
            notFound.push(mid);
            continue;
          }
          // messageDelete sets \Deleted and expunges (or moves to Trash on
          // servers configured that way) — either frees the INBOX quota.
          await client.messageDelete(uids.join(","), { uid: true });
          deleted.push(mid);
        } catch {
          notFound.push(mid); // treat any per-message failure as "leave it be"
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
  return { deleted, notFound };
}

/** Connect, authenticate, and confirm the INBOX is readable. Throws on failure. */
export async function verifyImap(cfg: ImapConfig): Promise<void> {
  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: imapAuth(cfg),
    logger: false,
    // Fail fast in the settings test rather than hang the request.
    socketTimeout: 15_000,
    greetingTimeout: 10_000,
  });
  // ImapFlow emits 'error' on socket timeouts / dropped connections; with no
  // listener, Node escalates that to an uncaughtException that destabilises the
  // entire worker process (including in-flight RTA imports). The operational
  // failure is already surfaced by the try/catch below — this listener just
  // swallows the late async socket error so it can't crash the process.
  client.on("error", () => {});
  try {
    await client.connect();
    try {
      await client.mailboxOpen("INBOX");
    } finally {
      await client.logout().catch(() => {});
    }
  } catch (e: any) {
    // Translate imapflow's cryptic "Command failed" into something actionable.
    throw new Error(describeMailError(e, "imap"));
  }
}

/**
 * Fetch INBOX messages with UID greater than `sinceUid` (newest unseen since the
 * last poll), parsed into a compact shape. Bounded by `limit` per call so one
 * busy inbox can't wedge the poller.
 */
export async function imapFetchSince(cfg: ImapConfig, sinceUid: number, limit = 50): Promise<InboundEmail[]> {
  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: imapAuth(cfg),
    logger: false,
    socketTimeout: 30_000,
    greetingTimeout: 10_000,
  });
  // See verifyImap — swallow late socket errors so a timeout can't crash the worker.
  client.on("error", () => {});
  const out: InboundEmail[] = [];
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const start = (sinceUid > 0 ? sinceUid : 0) + 1;
      // Guard against fetching an empty/backwards UID range. `client.mailbox`
      // (set by getMailboxLock) carries `exists` + `uidNext`. Once the poller has
      // caught up (start >= uidNext) or the INBOX is empty, fetching "start:*"
      // makes some servers reject the FETCH with a cryptic "Command failed" —
      // the bug behind inbound email silently never arriving.
      const mb: any = client.mailbox;
      const uidNext = Number(mb?.uidNext ?? 0);
      const exists = Number(mb?.exists ?? 0);
      const hasNew = exists > 0 && (uidNext === 0 || start < uidNext);
      if (hasNew) {
        // UID range "start:*" — a UID search always returns at least the last
        // message, so we guard each one against `sinceUid` below.
        for await (const msg of client.fetch(`${start}:*`, { uid: true, source: true }, { uid: true })) {
          if (!msg.uid || msg.uid <= sinceUid) continue;
          if (!msg.source) continue;
          const parsed = await simpleParser(msg.source as Buffer);
          const fromAddr = parsed.from?.value?.[0];
          const refs = Array.isArray(parsed.references) ? parsed.references.join(" ") : parsed.references;
          out.push({
            uid: msg.uid,
            messageId: parsed.messageId ?? undefined,
            inReplyTo: parsed.inReplyTo ?? undefined,
            references: refs ?? undefined,
            from: fromAddr?.address,
            fromName: fromAddr?.name,
            subject: parsed.subject,
            text: parsed.text,
            html: typeof parsed.html === "string" ? parsed.html : undefined,
            date: parsed.date,
          });
          if (out.length >= limit) break;
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
  return out;
}
