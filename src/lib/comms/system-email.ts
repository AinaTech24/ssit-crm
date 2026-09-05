/**
 * System / transactional email — for app-level emails that are NOT tenant
 * marketing comms: password resets, team invites, staff alerts.
 *
 * These deliberately BYPASS the templated dispatch() pipeline (consent gate,
 * compliance gate, DB templates) — those apply to client-facing messaging, not
 * to "here's your reset link" auth mail. We send straight through the email
 * adapter.
 *
 * Sender preference:
 *   1. the PLATFORM mailbox (Equitywala Admin → Email, or SMTP_* env)
 *   2. the TENANT's own mailbox, as a fallback
 *
 * The fallback matters: with no platform mailbox configured, password resets and
 * invites were silently dropped — /api/auth/forgot is deliberately
 * enumeration-safe, so it reports success either way and the user just never
 * receives anything. Falling back to the firm's own mailbox means a firm that has
 * connected one gets working resets without waiting on platform SMTP. A PLATFORM
 * admin has no tenant mailbox, so their reset still needs option 1 — another
 * admin can set their password from Super Admin → Admins in the meantime.
 *
 * Robustness contract: NEVER throws. If no sender can be resolved, or the
 * provider errors, it returns { sent: false, reason } and logs — so callers keep
 * their enumeration-safe behaviour and never 500 just because email isn't wired.
 */

import { emailAdapter } from "./adapters/resend";
import { loadEmailConfig } from "./email-config";
import { withSystem } from "@/db/client";
import { resolveEmailSender } from "./sender";

export type SystemEmailResult = { sent: boolean; reason?: string };

export async function sendSystemEmail(args: {
  tenantId: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Stable key so a retried send dedupes provider-side. */
  idempotencyKey?: string;
}): Promise<SystemEmailResult> {
  // Resolve the platform SMTP config — DB (Equitywala Admin → Email) first, env (SMTP_*)
  // as fallback.
  const cfg = await loadEmailConfig();

  let smtp: { host: string; port: number; secure: boolean; user: string; pass: string; accessToken?: string } | null = null;
  let from: string | undefined;

  if (cfg.configured && cfg.host) {
    smtp = { host: cfg.host, port: cfg.port, secure: cfg.secure, user: cfg.user ?? "", pass: cfg.pass ?? "" };
    from = cfg.from;
  } else {
    // No platform mailbox — borrow the tenant's own, so a firm that has connected
    // one still gets its resets and invites.
    try {
      const s = await withSystem(async (tx) => resolveEmailSender(tx, args.tenantId));
      if (s?.smtp?.host) {
        smtp = {
          host: s.smtp.host,
          port: s.smtp.port,
          secure: s.smtp.secure,
          user: s.smtp.user ?? "",
          pass: s.smtp.pass ?? "",
          accessToken: s.smtp.accessToken,
        };
        from = s.fromEmail ? (s.fromName ? `${s.fromName} <${s.fromEmail}>` : s.fromEmail) : undefined;
      }
    } catch {
      /* resolveEmailSender throws when nothing is connected — handled below */
    }
  }

  if (!smtp) {
    // Loud, because the symptom is invisible: the caller reports success and the
    // user simply never receives the mail.
    if (process.env.NODE_ENV === "production") {
      console.error(
        "[system-email] No sender available — set platform SMTP (Equitywala Admin → Email or SMTP_* env), " +
          `or connect a mailbox for tenant ${args.tenantId}. Email to ${args.to} ("${args.subject}") was NOT sent.`
      );
    }
    return { sent: false, reason: "email_not_configured" };
  }

  try {
    await emailAdapter.send({
      tenantId: args.tenantId,
      recipient: args.to,
      category: "transactional",
      tokens: {},
      rendered: { subject: args.subject, text: args.text, tokens: {} },
      inlineHtml: args.html,
      smtp,
      fromOverride: from,
      idempotencyKey: args.idempotencyKey,
    });
    return { sent: true };
  } catch (e: any) {
    console.error("[system-email] send failed:", e?.message ?? e);
    return { sent: false, reason: "send_failed" };
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Minimal, brand-neutral HTML for a transactional action email (a heading, a
 * line of context, and a single call-to-action button). Inline styles only —
 * email clients don't run our stylesheet.
 */
export function actionEmailHtml(opts: {
  heading: string;
  intro: string;
  buttonLabel: string;
  buttonUrl: string;
  note?: string;
}): string {
  return `<!doctype html>
<html><body style="margin:0;background:#f4f6f8;font-family:Inter,Arial,sans-serif;color:#16242b;">
  <div style="max-width:520px;margin:0 auto;padding:32px 20px;">
    <div style="background:#ffffff;border:1px solid #e6ebee;border-radius:14px;padding:28px;">
      <h1 style="margin:0 0 12px;font-size:20px;color:#16242b;">${escapeHtml(opts.heading)}</h1>
      <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#48585f;">${escapeHtml(opts.intro)}</p>
      <a href="${escapeHtml(opts.buttonUrl)}"
         style="display:inline-block;background:#0E2557;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 22px;border-radius:9px;">
        ${escapeHtml(opts.buttonLabel)}
      </a>
      <p style="margin:22px 0 0;font-size:12px;line-height:1.6;color:#8a979d;">
        ${opts.note ? escapeHtml(opts.note) + "<br/><br/>" : ""}
        If the button doesn't work, copy this link:<br/>
        <span style="word-break:break-all;color:#48585f;">${escapeHtml(opts.buttonUrl)}</span>
      </p>
    </div>
  </div>
</body></html>`;
}
