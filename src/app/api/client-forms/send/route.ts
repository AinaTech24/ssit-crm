import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/client-forms/send
 *
 * One call for "send the client a form to fill". Mints the right login-free
 * share link and delivers it by WhatsApp and/or email, through the same comms
 * pipeline (consent + compliance gated, audited) as every other send.
 *
 * Works for BOTH an investor and a lead — the existing
 * /api/leads/[id]/send-doc-checklist is lead-only and doc-only; this covers the
 * forms an RM actually needs in the field:
 *
 *   risk_profile        → /r   the SEBI questionnaire (must precede a recommendation)
 *   document_collection → /d   KYC / onboarding document upload
 *   financial_discovery → /fd  financial health check before a meeting
 *   portfolio_view      → /portfolio  login-free read-only holdings
 *
 * Body: { subjectType: "investor"|"lead", subjectId, kind, channel?: "whatsapp"|"email"|"both" }
 * →     { ok, url, waMeUrl, summary, emailed, whatsapped, emailError?, waStatus }
 *
 * WhatsApp prefers a Meta-APPROVED template (the only safe way to reach a client
 * outside the 24h window) and falls back to free-form; either way a wa.me URL is
 * returned so the RM can always send from their own WhatsApp.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { investors, leads, tenants, templates, templateVersions } from "@/db/schema";
import { createShareToken, type ShareTokenKind } from "@/lib/share-tokens";
import { ensureClientFormTemplate, type ClientFormKind } from "@/lib/client-forms/templates";
import { ensureDocCollectionTemplate } from "@/lib/onboarding/doc-template";
import { emailAdapter } from "@/lib/comms/adapters/resend";
import { resolveEmailSender } from "@/lib/comms/sender";
import { emailLogoHeaderHtml } from "@/lib/comms/email-logo";
import { dispatch } from "@/lib/comms/pipeline";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const KINDS = ["risk_profile", "document_collection", "financial_discovery", "portfolio_view"] as const;
type Kind = (typeof KINDS)[number];

const Body = z.object({
  subjectType: z.enum(["investor", "lead"]),
  subjectId: z.string().uuid(),
  kind: z.enum(KINDS),
  channel: z.enum(["whatsapp", "email", "both"]).default("both"),
  /** Reuse a link the caller already minted (the docs panel mints one that
   *  carries the chosen client type + checklist). Minting a second token here
   *  would send a DIFFERENT link than the one shown on screen. */
  url: z.string().url().optional(),
});

/** Per-form copy + the template-matching hint for the WhatsApp picker. */
const FORM: Record<Kind, { label: string; subject: string; cta: string; blurb: string; match: RegExp; expiresInDays: number }> = {
  risk_profile: {
    label: "Risk profile questionnaire",
    subject: "Please complete your risk profile",
    cta: "Complete risk profile",
    blurb: "It takes about 3 minutes and helps us recommend what genuinely suits you.",
    match: /risk|profile|suitab/i,
    expiresInDays: 14,
  },
  document_collection: {
    label: "Document upload",
    subject: "Documents needed for your investment account",
    cta: "Upload documents",
    blurb: "Please upload your KYC documents — PAN, Aadhaar, photo, bank proof.",
    match: /doc|kyc|onboard|document|collect|upload|checklist/i,
    expiresInDays: 7,
  },
  financial_discovery: {
    label: "Financial health check",
    subject: "A few questions before we meet",
    cta: "Start health check",
    blurb: "A short set of questions so our meeting is about you, not paperwork.",
    match: /discovery|health|fact.?find|profile/i,
    expiresInDays: 14,
  },
  portfolio_view: {
    label: "Portfolio link",
    subject: "Your portfolio — live view",
    cta: "View portfolio",
    blurb: "A secure, read-only view of your holdings. No login needed.",
    match: /portfolio|holding|statement/i,
    expiresInDays: 180,
  },
};

const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    // Sends a login-free form link to a client over WhatsApp/email — an outbound
    // client communication, so gate it like one rather than on session alone.
    requireAny(session.roles, ["communication.send", "investor.edit.assigned"], session.permissions);
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const { subjectType, subjectId, kind, channel } = parsed.data;
    const form = FORM[kind as Kind];

    // Resolve the recipient + firm branding + the firm's own mail sender.
    const ctx = await withTenant(session.tenantId, async (tx) => {
      const row =
        subjectType === "investor"
          ? (await tx.select().from(investors).where(and(eq(investors.id, subjectId), eq(investors.tenantId, session.tenantId))).limit(1))[0]
          : (await tx.select().from(leads).where(and(eq(leads.id, subjectId), eq(leads.tenantId, session.tenantId))).limit(1))[0];
      const tenant = (await tx.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1))[0] ?? null;
      let sender: Awaited<ReturnType<typeof resolveEmailSender>>;
      sender = await resolveEmailSender(tx, session.tenantId, session.userId);
      return { row, tenant, sender };
    });

    if (!ctx.row) return NextResponse.json({ error: `${subjectType} not found` }, { status: 404 });

    const r = ctx.row as any;
    const name = r.name ?? "there";
    const email = (r.email as string | null) ?? null;
    const phone = ((subjectType === "investor" ? r.whatsappPhone || r.phone : r.phone) as string | null) ?? null;
    const firmName = (ctx.tenant as any)?.displayName ?? (ctx.tenant as any)?.legalName ?? "Your advisor";
    const logoUrl = (ctx.tenant as any)?.logoUrl ?? null;
    const arn = (ctx.tenant as any)?.arn ?? null;

    if (!email && !phone) {
      return NextResponse.json({ error: "This client has no email or phone on file — add a contact first." }, { status: 400 });
    }

    // 1. Mint the login-free link.
    let url: string;
    let tokenId: string;
    if (parsed.data.url) {
      url = parsed.data.url;
      tokenId = url.split("/").pop()?.slice(0, 8) ?? "reuse";
    } else {
      const token = await createShareToken({
        tenantId: session.tenantId,
        kind: kind as ShareTokenKind,
        subjectType,
        subjectId,
        expiresInDays: form.expiresInDays,
        createdBy: session.userId,
      });
      url = (token as any).url as string;
      tokenId = String((token as any).token ?? "").slice(0, 8);
    }
    const waText = `Hi ${name}, ${form.blurb}\n\n${url}`;

    // 2. Email through the firm's own sender.
    let emailed = false;
    let emailError: string | undefined;
    if (channel === "whatsapp") {
      emailError = "skipped";
    } else if (!email) {
      emailError = "no email on file";
    } else if (!(ctx.sender.smtp?.host)) {
      emailError = "no mailbox connected (Settings → Email)";
    } else {
      try {
        const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#0f172a;">
          ${emailLogoHeaderHtml(logoUrl, firmName)}
          <div style="padding:4px 4px 0;">
            <p>Hi ${esc(name)},</p>
            <p>${esc(form.blurb)}</p>
            <p style="margin:18px 0;"><a href="${esc(url)}" style="background:#0e2557;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600;display:inline-block;">${esc(form.cta)}</a></p>
            <p style="margin-top:18px;">Warm regards,<br/><strong>${esc(firmName)}</strong></p>
          </div>
          <div style="margin-top:22px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;line-height:1.6;">
            <div><strong style="color:#64748b;">${esc(firmName)}</strong>${arn ? ` &middot; ${esc(arn)}` : ""}</div>
            <div>Mutual fund investments are subject to market risks; read all scheme-related documents carefully.</div>
          </div>
        </div>`;
        await emailAdapter.send({
          tenantId: session.tenantId,
          recipient: email,
          category: "transactional",
          tokens: {},
          rendered: { subject: form.subject, text: `Hi ${name}, ${form.blurb}\n\n${url}`, tokens: {} },
          inlineHtml: html,
          smtp: ctx.sender.smtp,
          fromOverride: ctx.sender.fromEmail || undefined,
          fromNameOverride: ctx.sender.fromName || firmName,
          replyTo: ctx.sender.replyTo || undefined,
          idempotencyKey: `client-form:${kind}:${subjectId}:${tokenId}`,
        } as any);
        emailed = true;
      } catch (e: any) {
        const m = String(e?.message ?? "");
        emailError = /RESEND_API_KEY|EAUTH|invalid login|535|ECONNREFUSED|getaddrinfo|ETIMEDOUT|certificate|authentication|domain/i.test(m)
          ? "mailbox rejected the send (check Settings → Email)"
          : m.slice(0, 120) || "send failed";
      }
    }

    // 3. WhatsApp — approved template first, free-form as fallback.
    let waStatus = phone ? "not attempted" : "no phone on file";
    let whatsapped = false;
    let usedTemplate = false;
    if (phone && channel !== "email") {
      try {
        waStatus = await withTenant(session.tenantId, async (tx) => {
          const rows = await tx
            .select({ key: templates.key, name: templates.name, vars: templateVersions.variables })
            .from(templates)
            .innerJoin(templateVersions, eq(templateVersions.id, templates.currentVersionId))
            .where(and(
              eq(templates.tenantId, session.tenantId),
              eq(templates.channel as any, "whatsapp" as any),
              eq(templates.status, "approved"),
            ));
          const tmpl = rows.find((t) => form.match.test(`${t.key} ${t.name}`)) ?? null;
          usedTemplate = !!tmpl;
          const link = subjectType === "investor" ? { investorId: subjectId } : { leadId: subjectId };

          if (tmpl) {
            const varKeys = ((tmpl.vars as any[]) ?? []).map((v) => v?.key).filter(Boolean);
            const linkKey = varKeys.find((k: string) => /url|link/i.test(k)) ?? varKeys[0];
            const nameKey = varKeys.find((k: string) => /name|client|investor/i.test(k));
            const variables: Record<string, string> = {};
            if (linkKey) variables[linkKey] = url;
            if (nameKey) variables[nameKey] = name;
            const d = await dispatch(tx, {
              tenantId: session.tenantId, channel: "whatsapp", templateKey: tmpl.key,
              recipient: phone, variables, category: "utility", ...link,
            } as any);
            return String((d as any)?.status ?? "queued");
          }
          const d = await dispatch(tx, {
            tenantId: session.tenantId, channel: "whatsapp", freeformText: waText,
            recipient: phone, category: "utility", ...link,
          } as any);
          return String((d as any)?.status ?? "queued");
        });
        whatsapped = ["sent", "delivered", "queued"].includes(waStatus);
      } catch {
        waStatus = "failed";
      }
    }

    // Self-heal: no approved template means every proactive send is doomed to
    // `skipped_session`. Provision one and submit it to Meta so the NEXT send
    // delivers automatically (approval takes ~1–24h). Best-effort, never throws.
    let templateNote: string | null = null;
    if (phone && channel !== "email" && !usedTemplate) {
      const prov = kind === "document_collection"
        ? await ensureDocCollectionTemplate(session.tenantId, session.userId)
        : await ensureClientFormTemplate(kind as ClientFormKind, session.tenantId, session.userId);
      if (prov.submitted || prov.status === "pending_approval") {
        templateNote = "WhatsApp template submitted to Meta — future sends deliver automatically once approved (1–24h)";
      } else if (prov.error === "WhatsApp not connected") {
        templateNote = "Connect WhatsApp (Settings → WhatsApp) so these can send automatically";
      }
    }

    // Always hand back a wa.me fallback — Meta's 24h rule means a proactive
    // platform send can legitimately not deliver, and the RM still needs to send.
    const waMeUrl = phone ? `https://wa.me/${phone.replace(/[^\d]/g, "")}?text=${encodeURIComponent(waText)}` : null;
    const summary = [
      channel === "whatsapp" ? null : emailed ? "📧 Email sent" : `📧 Email — ${emailError ?? "not sent"}`,
      channel === "email" ? null : whatsapped ? "💬 WhatsApp sent" : phone ? `💬 WhatsApp — ${waStatus.replace(/_/g, " ")}` : "💬 no phone on file",
    ].filter(Boolean).join("  ·  ");

    return NextResponse.json({
      ok: emailed || whatsapped,
      kind, label: form.label, url, waMeUrl, summary, emailed, whatsapped, waStatus,
      ...(templateNote ? { templateNote } : {}),
      ...(emailError ? { emailError } : {}),
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
