import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/leads/[id]/send-doc-checklist
 *
 * One-click: mint a secure document-collection link and send it to the client by
 * BOTH email (the firm's connected mailbox / Resend — NOT the global system
 * sender) and WhatsApp (the comms pipeline → Vartify). Reports the REAL per-channel
 * outcome and always returns a wa.me fallback so the advisor can send from their
 * own WhatsApp when a proactive platform send can't be delivered (Meta's 24h
 * rule for non-template messages).
 *
 * Body: { clientType?: ClientType } → { ok, url, summary, emailed, whatsapp, waMeUrl }
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { leads, tenants, templates, templateVersions } from "@/db/schema";
import { createShareToken } from "@/lib/share-tokens";
import { emailAdapter } from "@/lib/comms/adapters/resend";
import { resolveEmailSender } from "@/lib/comms/sender";
import { emailLogoHeaderHtml } from "@/lib/comms/email-logo";
import { dispatch } from "@/lib/comms/pipeline";
import { getChecklist, type ClientType } from "@/lib/onboarding/doc-checklists";
import { getFieldChecklist } from "@/lib/onboarding/kyc-fields";
import { ensureDocCollectionTemplate } from "@/lib/onboarding/doc-template";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DOCS_LINE = "PAN card, Aadhaar, passport-size photo, recent bank statement, cancelled cheque";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "lead.edit.assigned", session.permissions);

    const body = await req.json().catch(() => ({}));
    const clientType = (["individual", "huf", "nri", "minor", "company", "trust"].includes(body?.clientType)
      ? body.clientType
      : "individual") as ClientType;

    const ctx = await withTenant(session.tenantId, async (tx) => {
      const lead = (await tx.select().from(leads).where(and(eq(leads.id, id), eq(leads.tenantId, session.tenantId))).limit(1))[0] ?? null;
      const tenant = (await tx.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1))[0] ?? null;
      let sender: Awaited<ReturnType<typeof resolveEmailSender>>;
      sender = await resolveEmailSender(tx, session.tenantId, session.userId);
      return { lead, tenant, sender };
    });

    if (!ctx.lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

    const name = (ctx.lead as any).name ?? "there";
    const email = (ctx.lead as any).email as string | null;
    const phone = (ctx.lead as any).phone as string | null;
    const investorId = (ctx.lead as any).convertedInvestorId as string | null;
    const firmName = (ctx.tenant as any)?.displayName ?? (ctx.tenant as any)?.legalName ?? "Your advisor";
    const logoUrl = (ctx.tenant as any)?.logoUrl as string | null;
    const arn = (ctx.tenant as any)?.arn as string | null;

    if (!email && !phone) {
      return NextResponse.json({ error: "This client has no email or phone on file — add a contact first." }, { status: 400 });
    }

    // 1. Mint the secure, single-use document-collection link.
    const requiredDocs = getChecklist(clientType);
    const requiredFields = getFieldChecklist(clientType);
    const token = await createShareToken({
      tenantId: session.tenantId,
      kind: "document_collection",
      subjectType: investorId ? "investor" : "lead",
      subjectId: investorId ?? id,
      payload: { requiredDocs, requiredFields, clientType },
      expiresInDays: 7,
      createdBy: session.userId,
    });
    const url = (token as any).url as string;
    const tokenId = String((token as any).token ?? "").slice(0, 8);

    const waText = `Hi ${name}, please upload your KYC documents to complete your account setup — secure, single-use link:\n\n${url}\n\nYou'll need: ${DOCS_LINE}.`;

    // 2. Email via the firm's connected sender (mailbox / Resend).
    let emailed = false;
    let emailError: string | undefined;
    const canEmail = !!email && !!(ctx.sender.smtp?.host);
    if (!email) {
      emailError = "no email on file";
    } else if (!canEmail) {
      emailError = "no mailbox connected (Settings → Email)";
    } else {
      try {
        const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#0f172a;">
          ${emailLogoHeaderHtml(logoUrl, firmName)}
          <div style="padding:4px 4px 0;">
            <p>Hi ${escapeHtml(name)},</p>
            <p>To complete your account setup, please upload your KYC documents using this secure, single-use link:</p>
            <p style="margin:18px 0;"><a href="${escapeAttr(url)}" style="background:#841f21;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600;display:inline-block;">Upload documents</a></p>
            <p style="font-size:13px;color:#475569;">Required: ${DOCS_LINE}.</p>
            <p style="margin-top:18px;">Warm regards,<br/><strong>${escapeHtml(firmName)}</strong></p>
          </div>
          <div style="margin-top:22px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;line-height:1.6;">
            <div><strong style="color:#64748b;">${escapeHtml(firmName)}</strong>${arn ? ` &middot; ${escapeHtml(arn)}` : ""}</div>
            <div>The link is single-use and expires in 7 days. Mutual fund investments are subject to market risks; read all scheme-related documents carefully.</div>
          </div>
        </div>`;
        await emailAdapter.send({
          tenantId: session.tenantId,
          recipient: email,
          category: "transactional",
          tokens: {},
          rendered: { subject: "Documents needed for your investment account", text: `Hi ${name}, please upload your KYC documents using this secure link: ${url}\n\nRequired: ${DOCS_LINE}.`, tokens: {} },
          inlineHtml: html,
          smtp: ctx.sender.smtp,
          fromOverride: ctx.sender.fromEmail || undefined,
          fromNameOverride: ctx.sender.fromName || firmName,
          replyTo: ctx.sender.replyTo || undefined,
          idempotencyKey: `doc-checklist:${id}:${tokenId}`,
        });
        emailed = true;
      } catch (e: any) {
        const m = String(e?.message ?? "");
        emailError = /RESEND_API_KEY|EAUTH|invalid login|535|ECONNREFUSED|getaddrinfo|ETIMEDOUT|certificate|authentication|domain/i.test(m)
          ? "mailbox rejected the send (check Settings → Email)"
          : (m.slice(0, 120) || "send failed");
      }
    }

    // 3. WhatsApp. A Meta-APPROVED template is the only way to message a client
    //    outside the 24h window safely, so prefer a document/KYC template; only
    //    fall back to free-form (which delivers only inside the window) when none
    //    exists. Either way the wa.me fallback covers non-delivery.
    let waStatus = "no phone on file";
    let whatsapped = false;
    let waUsedTemplate = false;
    if (phone) {
      const tmpl = await withTenant(session.tenantId, async (tx) => {
        const rows = await tx
          .select({ key: templates.key, name: templates.name, vars: templateVersions.variables })
          .from(templates)
          .innerJoin(templateVersions, eq(templateVersions.id, templates.currentVersionId))
          .where(and(
            eq(templates.tenantId, session.tenantId),
            eq(templates.channel as any, "whatsapp" as any),
            eq(templates.status, "approved"),
          ));
        return rows.find((r) => /doc|kyc|onboard|document|collect|upload|checklist/i.test(`${r.key} ${r.name}`)) ?? null;
      });

      try {
        waStatus = await withTenant(session.tenantId, async (tx) => {
          if (tmpl) {
            waUsedTemplate = true;
            const varKeys = ((tmpl.vars as any[]) ?? []).map((v) => v?.key).filter(Boolean);
            const linkKey = varKeys.find((k: string) => /url|link|doc|upload/i.test(k)) ?? varKeys[0];
            const nameKey = varKeys.find((k: string) => /name|client|investor/i.test(k));
            const variables: Record<string, string> = {};
            if (linkKey) variables[linkKey] = url;
            if (nameKey) variables[nameKey] = name;
            const r = await dispatch(tx, {
              tenantId: session.tenantId, channel: "whatsapp", templateKey: tmpl.key,
              recipient: phone, variables, category: "utility",
              investorId: investorId ?? undefined, leadId: investorId ? undefined : id,
            } as any);
            return String((r as any)?.status ?? "queued");
          }
          const r = await dispatch(tx, {
            tenantId: session.tenantId, channel: "whatsapp", freeformText: waText,
            recipient: phone, category: "utility",
            investorId: investorId ?? undefined, leadId: investorId ? undefined : id,
          } as any);
          return String((r as any)?.status ?? "queued");
        });
        whatsapped = ["sent", "delivered", "queued"].includes(waStatus);
      } catch (e: any) {
        waStatus = "failed";
      }
    }

    // If WhatsApp couldn't go via an approved template, self-provision one and
    // submit it to Meta so future sends deliver automatically (best-effort).
    let templateNote: string | null = null;
    if (!waUsedTemplate) {
      const prov = await ensureDocCollectionTemplate(session.tenantId, session.userId);
      if (prov.submitted || prov.status === "pending_approval") templateNote = "WhatsApp template submitted to Meta — auto-sends once approved (1–24h)";
      else if (prov.status === "approved") templateNote = null;
    }

    const waMeUrl = phone ? `https://wa.me/${phone.replace(/[^\d]/g, "")}?text=${encodeURIComponent(waText)}` : null;
    const ok = emailed || whatsapped;
    const summary = [
      emailed ? "📧 Email sent" : `📧 Email — ${emailError ?? "not sent"}`,
      whatsapped ? "💬 WhatsApp sent" : phone ? `💬 WhatsApp — ${waStatus.replace(/_/g, " ")} (use the link below)` : "💬 no phone on file",
      templateNote ? `⏳ ${templateNote}` : "",
    ].filter(Boolean).join("  ·  ");

    return NextResponse.json({ ok, url, summary, emailed, emailError, whatsapp: { status: waStatus, sent: whatsapped }, templateNote, waMeUrl });
  } catch (err: any) {
    return handleApiError(err);
  }
}

function escapeHtml(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(s: string): string {
  return String(s).replace(/"/g, "&quot;");
}
