/**
 * System / transactional email — for app-level emails that are NOT tenant
 * marketing comms: password resets, team invites, staff alerts.
 *
 * These deliberately BYPASS the templated dispatch() pipeline (consent gate,
 * compliance gate, DB templates) — those apply to client-facing messaging, not
 * to "here's your reset link" auth mail. We send straight through the email
 * adapter.
 *
 * Robustness contract: NEVER throws. If RESEND_API_KEY isn't configured (dev /
 * stub) or the provider errors, it returns { sent: false, reason } and logs —
 * so callers like /api/auth/forgot can keep their enumeration-safe behaviour
 * and never 500 just because email isn't wired.
 */

import { emailAdapter } from "./adapters/resend";
import { loadEmailConfig } from "./email-config";

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
  // Resolve the platform SMTP config — DB (SSIT Admin → Email) first, env (SMTP_*)
  // as fallback.
  const cfg = await loadEmailConfig();
  if (!cfg.configured || !cfg.host) {
    // In production this silently breaks onboarding (invited users / reset
    // links never arrive). Surface it loudly instead of failing invisibly.
    if (process.env.NODE_ENV === "production") {
      console.error(
        "[system-email] SMTP is not configured (SSIT Admin → Email, or SMTP_* env) — " +
          `transactional auth email (to ${args.to}, subject "${args.subject}") was NOT sent.`
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
      smtp: { host: cfg.host, port: cfg.port, secure: cfg.secure, user: cfg.user ?? "", pass: cfg.pass ?? "" },
      fromOverride: cfg.from,
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
