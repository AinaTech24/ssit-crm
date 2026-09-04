/**
 * Resend email adapter.
 *
 * Resend has a clean REST API + idempotency keys + webhook for delivery
 * events. For each tenant we use the same Resend API key initially but
 * route through tenant-specific verified domains.
 *
 * Migration path: when we exceed ~1M emails/month or need dedicated IPs
 * for marketing, swap to AWS SES via the same interface — the rest of the
 * codebase will not change.
 */

import { Resend } from "resend";
import nodemailer from "nodemailer";
import { describeMailError } from "../connection-error";
import { wrapLinksForTracking } from "../click-tracking";
import type { TemplateVersion } from "@/db/schema";

/** Per-MFD SMTP mailbox — send client email straight from the firm's own server. */
export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  /** XOAUTH2 access token (Gmail / M365 connected over OAuth). Wins over `pass`. */
  accessToken?: string;
}

let client: Resend | null = null;
function getClient(apiKey?: string): Resend {
  if (apiKey) {
    return new Resend(apiKey);
  }
  if (!client) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("RESEND_API_KEY not set");
    client = new Resend(key);
  }
  return client;
}

export interface SendEmailArgs {
  tenantId: string;
  /** Omitted for ad-hoc Compose sends — pass `inlineHtml` instead. */
  templateVersion?: TemplateVersion;
  tokens: Record<string, string>;
  rendered: { subject?: string; text: string; tokens: Record<string, string> };
  recipient: string;
  category: "transactional" | "marketing";
  cc?: string[];
  bcc?: string[];
  /** Pre-rendered HTML for ad-hoc Compose (no template). Wins over templateVersion. */
  inlineHtml?: string;
  apiKey?: string;
  fromOverride?: string;
  fromNameOverride?: string;
  /** Reply-To — routes client replies to the MFD's own inbox. */
  replyTo?: string;
  /** When set, send via the MFD's own SMTP server instead of Resend. */
  smtp?: SmtpConfig;
  /** Stable key so a re-fired send dedupes provider-side (Resend idempotency). */
  idempotencyKey?: string;
  /** When set (campaign sends), rewrite links through the click-tracking redirect
   *  keyed by this communication id. */
  trackingId?: string;
  /** In-memory attachments (e.g. a generated proposal/statement PDF). */
  attachments?: Array<{ filename: string; content: Buffer }>;
}

export const emailAdapter = {
  async send(args: SendEmailArgs): Promise<{ externalId: string; status: "sent" | "queued" }> {
    const baseFrom =
      args.fromOverride ??
      (args.category === "marketing"
        ? process.env.EMAIL_FROM_MARKETING ?? "Equitywala <connect@ssit.com>"
        : process.env.EMAIL_FROM_TRANSACTIONAL ?? "Equitywala <connect@ssit.com>");

    const from = args.fromNameOverride ? `${args.fromNameOverride} <${baseFrom}>` : baseFrom;

    // Lazy import: the renderer is a .tsx module (React Email JSX) — loading it
    // only on the template path keeps this adapter importable from plain-TS
    // contexts (unit tests, scripts) without a JSX transform.
    let html =
      args.inlineHtml ??
      (args.templateVersion
        ? (await import("../email_renderer")).renderEmailTemplate(args.templateVersion.body as any, args.tokens)
        : `<p>${args.rendered.text.replace(/\n/g, "<br/>")}</p>`);

    // Campaign sends: rewrite links through the click-tracking redirect. Wrapped
    // defensively — tracking must never break the actual email going out.
    if (args.trackingId) {
      try {
        html = wrapLinksForTracking(html, args.trackingId);
      } catch {
        /* keep the unwrapped html */
      }
    }

    // Template-level attachments (factsheet, KYC form, …) — Resend fetches by URL.
    const tplAttachments = (args.templateVersion?.attachments as Array<{ name: string; url: string }> | undefined) ?? [];
    const attachments: Array<{ filename: string; path?: string; content?: Buffer }> = [
      ...tplAttachments
        .filter((a) => a?.url)
        .map((a) => ({ filename: a.name || a.url.split("/").pop() || "attachment", path: a.url })),
      ...(args.attachments ?? []).map((a) => ({ filename: a.filename, content: a.content })),
    ];

    // MFD-owned SMTP path: send straight through the firm's mail server so the
    // message genuinely originates from their mailbox (authentic From; no Resend
    // domain verification required). `from`, `html`, `attachments` are already
    // built above and shared with the Resend path.
    if (args.smtp?.host) {
      const transporter = nodemailer.createTransport({
        host: args.smtp.host,
        port: args.smtp.port,
        secure: args.smtp.secure,
        // STARTTLS upgrade for 587 (e.g. Microsoft 365) when not implicit-TLS.
        requireTLS: !args.smtp.secure,
        auth: args.smtp.accessToken
          ? { type: "OAuth2", user: args.smtp.user, accessToken: args.smtp.accessToken }
          : { user: args.smtp.user, pass: args.smtp.pass },
      });
      const info = await transporter.sendMail({
        from,
        to: args.recipient,
        replyTo: args.replyTo || undefined,
        cc: args.cc?.length ? args.cc : undefined,
        bcc: args.bcc?.length ? args.bcc : undefined,
        subject: args.rendered.subject ?? "(no subject)",
        html,
        text: args.rendered.text,
        attachments: attachments.length ? attachments : undefined,
      });
      return { externalId: info.messageId, status: "sent" };
    }

    const c = getClient(args.apiKey);
    const res = await c.emails.send(
      {
        from,
        to: [args.recipient],
        replyTo: args.replyTo || undefined,
        cc: args.cc?.length ? args.cc : undefined,
        bcc: args.bcc?.length ? args.bcc : undefined,
        subject: args.rendered.subject ?? "(no subject)",
        html,
        text: args.rendered.text,
        attachments: attachments.length ? attachments : undefined,
        tags: [
          { name: "tenant_id", value: args.tenantId },
          { name: "template_key", value: args.templateVersion?.id ?? "adhoc_compose" },
        ],
      },
      args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : undefined
    );
    if (res.error) {
      throw new Error(`Resend error: ${res.error.message}`);
    }
    return { externalId: res.data?.id ?? "", status: "sent" };
  },


  /** Verify Resend webhook (uses Svix-style headers). */
  verifyWebhookSignature(rawBody: string, headers: Record<string, string>): boolean {
    const secret = process.env.RESEND_WEBHOOK_SECRET;
    if (!secret) return false;
    const signature = headers["svix-signature"] ?? headers["resend-signature"];
    if (!signature) return false;

    const crypto = require("crypto") as typeof import("crypto");
    // Svix secrets are `whsec_<base64>`; the HMAC key is the decoded base64.
    // Tolerate a raw secret too (back-compat with however it was configured).
    const key = secret.startsWith("whsec_")
      ? Buffer.from(secret.slice(6), "base64")
      : Buffer.from(secret);

    const svixId = headers["svix-id"];
    const svixTimestamp = headers["svix-timestamp"];

    // Proper Svix verification: sign `${id}.${timestamp}.${body}` AND reject
    // stale timestamps so a captured payload can't be replayed forever.
    if (svixId && svixTimestamp) {
      const ts = Number(svixTimestamp);
      const TOLERANCE_S = 5 * 60;
      if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > TOLERANCE_S) {
        return false; // missing/old/future timestamp → replay or clock skew
      }
      const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
      const expected = crypto.createHmac("sha256", key).update(signedContent).digest("base64");
      return signature
        .split(" ")
        .some((s) => {
          const part = s.includes(",") ? s.split(",")[1] : s;
          return safeEqual(part.trim(), expected);
        });
    }

    // Fallback (no Svix id/timestamp headers): body-only HMAC. No replay
    // protection, but preserves a working non-Svix signature integration.
    const expected = crypto.createHmac("sha256", key).update(rawBody).digest("base64");
    return signature.split(",").some((s) => safeEqual(s.trim(), `v1,${expected}`) || safeEqual(s.trim(), expected));
  },
};

/** Verify an SMTP mailbox can authenticate + accept mail. Throws on failure. */
export async function verifySmtp(smtp: SmtpConfig): Promise<void> {
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: { user: smtp.user, pass: smtp.pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
  });
  try {
    await transporter.verify();
  } catch (e: any) {
    throw new Error(describeMailError(e, "smtp"));
  }
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
