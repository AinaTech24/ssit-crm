/**
 * Send a client their live portfolio statement. SERVER-ONLY.
 *
 * Shared by the manual "Email/WhatsApp statement" action and the scheduled
 * auto-statement worker, so both render the SAME live PDF (valueInvestor +
 * AMFI NAV) and leave the same communications audit row.
 *
 *   email    → renders the PDF + emails it as an attachment (Resend), audited.
 *   whatsapp → returns a wa.me URL with a value summary (the RM sends it).
 *
 * Transactional document (the client's own portfolio), so it isn't gated on
 * marketing consent — but every send still writes a communications row.
 */

import { v4 as uuid } from "uuid";
import { and, eq } from "drizzle-orm";
import { Resend } from "resend";
import nodemailer from "nodemailer";
import type { Tx } from "@/db/client";
import { investors, tenants, communications } from "@/db/schema";
import { valueInvestor } from "./valuation";
import { renderValuationStatementPdf } from "./valuation-pdf";
import { recordAudit } from "@/lib/audit";
import { translateText } from "@/lib/comms/translate";
import { gateClientSend } from "@/lib/comms/guarded-send";
import { resolveEmailSender } from "@/lib/comms/sender";
import { formatINR } from "@/lib/utils";

export type StatementChannel = "email" | "whatsapp";

export type SendStatementResult =
  | { ok: true; channel: StatementChannel; externalId: string | null; waUrl: string | null; recipient: string | null }
  | { ok: false; error: string; status: number };

let resendClient: Resend | null = null;
function getResend(): Resend | null {
  if (resendClient) return resendClient;
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  resendClient = new Resend(key);
  return resendClient;
}

function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D+/g, "");
  if (!digits) return null;
  if (digits.length === 10 && /^[6-9]/.test(digits)) return `91${digits}`;
  return digits;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}

/**
 * Render + send one investor's statement. `actorUserId` is null for the
 * scheduled worker (system send). Returns a discriminated result so HTTP
 * callers can map to a status code.
 */
export async function sendInvestorStatement(
  tx: Tx,
  args: { tenantId: string; investorId: string; channel: StatementChannel; actorUserId?: string | null }
): Promise<SendStatementResult> {
  const [inv] = await tx
    .select()
    .from(investors)
    .where(and(eq(investors.id, args.investorId), eq(investors.tenantId, args.tenantId)))
    .limit(1);
  if (!inv) return { ok: false, error: "not found", status: 404 };

  const valuation = await valueInvestor(tx, args.investorId);
  const [t] = await tx.select().from(tenants).where(eq(tenants.id, args.tenantId)).limit(1);
  const tenant = t as any;
  const lang = (inv as any).languagePref ?? "en";

  const generatedAt = new Date().toISOString();
  const pdf = await renderValuationStatementPdf({
    valuation,
    investor: { name: inv.name, pan: inv.pan },
    brand: {
      displayName: tenant?.displayName,
      legalName: tenant?.legalName,
      arn: tenant?.arn,
      primaryColor: tenant?.primaryColor,
      phone: tenant?.phone,
      email: tenant?.email,
      website: tenant?.website,
    },
    generatedAt,
  });

  let externalId: string | null = null;
  let waUrl: string | null = null;
  let recipientUsed: string | null = null;
  // Compliance + consent snapshots captured at the gate, persisted on the row.
  let complianceSnapshot: any = null;
  let complianceScore: number | null = null;
  let consentSnapshot: any = null;

  if (args.channel === "email") {
    if (!inv.email) return { ok: false, error: "client has no email on file", status: 400 };
    recipientUsed = inv.email;
    const arnLine = `${tenant?.legalName ?? tenant?.displayName ?? ""} · ARN ${tenant?.arn ?? "—"}`;
    const bodyLines = [
      `Dear ${inv.name ?? "Investor"},`,
      `Please find your latest portfolio valuation statement attached. Current value: ${formatINR(valuation.currentValue)}` +
        (valuation.xirr != null ? ` · XIRR ${(valuation.xirr * 100).toFixed(2)}% p.a.` : "") + ".",
    ];
    const translated = await translateText(bodyLines, lang);
    const html =
      `<p>${escapeHtml(translated[0])}</p>` +
      `<p>${escapeHtml(translated[1])}</p>` +
      `<p style="color:#64748b;font-size:12px">${escapeHtml(arnLine)} · Mutual Fund investments are subject to market risks. Read all scheme related documents carefully.</p>`;
    // Compliance + consent gate (transactional document).
    const gate = await gateClientSend(tx, {
      tenantId: args.tenantId, channel: "email", category: "transactional",
      text: html, subject: `Your portfolio statement — ${tenant?.displayName ?? "Investment update"}`,
      investorId: args.investorId,
    });
    if (!gate.allowed) return { ok: false, error: `Statement blocked: ${gate.detail}`, status: 422 };
    complianceSnapshot = gate.complianceFindings; complianceScore = gate.complianceScore; consentSnapshot = gate.consentSnapshot;
    // Resolve the real sender the same way the rest of the app does — the firm/RM
    // mailbox (SMTP/OAuth) first, then a tenant or env Resend key. NEVER fake a
    // send: if nothing is connected, fail clearly so the RM knows to set it up.
    const subject = `Your portfolio statement — ${tenant?.displayName ?? "Investment update"}`;
    const attachments = [{ filename: "portfolio-statement.pdf", content: pdf }];
    const sender = await resolveEmailSender(tx, args.tenantId, args.actorUserId);
    const fromAddr = sender.fromEmail || sender.smtp?.user || process.env.EMAIL_FROM_TRANSACTIONAL || "";
    const from = sender.fromName ? `${sender.fromName} <${fromAddr}>` : fromAddr;
    const resendKey = sender.apiKey || process.env.RESEND_API_KEY;
    try {
      if (sender.smtp?.host) {
        const transporter = nodemailer.createTransport({
          host: sender.smtp.host,
          port: sender.smtp.port,
          secure: sender.smtp.secure,
          requireTLS: !sender.smtp.secure,
          auth: sender.smtp.accessToken
            ? { type: "OAuth2", user: sender.smtp.user, accessToken: sender.smtp.accessToken }
            : { user: sender.smtp.user, pass: sender.smtp.pass },
        });
        const info = await transporter.sendMail({
          from: from || sender.smtp.user,
          to: inv.email,
          replyTo: sender.replyTo || undefined,
          subject,
          html,
          attachments,
        });
        externalId = info.messageId;
      } else if (resendKey) {
        const client = new Resend(resendKey);
        const result = await client.emails.send({
          from: from || "Equitywala <connect@ssit.com>",
          to: [inv.email],
          subject,
          html,
          attachments,
        } as any);
        externalId = (result as any)?.data?.id ?? null;
      } else {
        return {
          ok: false,
          error: "No email sender connected — connect your mailbox in Settings → Integrations → Mailbox (or add a Resend key), then retry.",
          status: 422,
        };
      }
    } catch (e: any) {
      return { ok: false, error: `Email send failed: ${e?.message ?? "unknown"}`, status: 502 };
    }
  } else {
    const phone = normalizePhone(inv.phone);
    if (!phone) return { ok: false, error: "client has no phone number on file", status: 400 };
    recipientUsed = phone;
    const summary = [
      `Hi ${inv.name ?? ""},`,
      `Your portfolio is currently valued at ₹${Math.round(valuation.currentValue).toLocaleString("en-IN")}` +
        (valuation.xirr != null ? ` (XIRR ${(valuation.xirr * 100).toFixed(1)}% p.a.)` : "") + ".",
      "We've emailed your detailed statement. Reply here if you'd like to review it together.",
    ];
    const translated = await translateText(summary, lang);
    const lines = [...translated, "", `— ${tenant?.displayName ?? ""}`, `ARN ${tenant?.arn ?? "—"}`];
    const gate = await gateClientSend(tx, {
      tenantId: args.tenantId, channel: "whatsapp", category: "transactional",
      text: lines.join("\n"), investorId: args.investorId,
    });
    if (!gate.allowed) return { ok: false, error: `Statement blocked: ${gate.detail}`, status: 422 };
    complianceSnapshot = gate.complianceFindings; complianceScore = gate.complianceScore; consentSnapshot = gate.consentSnapshot;
    waUrl = `https://wa.me/${phone}?text=${encodeURIComponent(lines.join("\n"))}`;
  }

  await tx.insert(communications).values({
    tenantId: args.tenantId,
    investorId: args.investorId,
    userId: args.actorUserId ?? null,
    channel: args.channel,
    direction: "outbound",
    status: "sent",
    externalId,
    payload: {
      kind: "valuation_statement",
      currentValue: valuation.currentValue,
      xirr: valuation.xirr,
      recipient: recipientUsed,
      generatedAt,
      scheduled: args.actorUserId == null,
    } as any,
    consentSnapshot: consentSnapshot as any,
    complianceSnapshot: complianceSnapshot as any,
    complianceScore: complianceScore != null ? String(complianceScore) : null,
    sentAt: new Date(),
  } as any);

  await recordAudit(tx, {
    tenantId: args.tenantId,
    actorUserId: args.actorUserId ?? null,
    action: "investor.statement.send",
    entityType: "investor",
    entityId: args.investorId,
    after: { channel: args.channel, recipient: recipientUsed, externalId, currentValue: valuation.currentValue },
  });

  return { ok: true, channel: args.channel, externalId, waUrl, recipient: recipientUsed };
}
