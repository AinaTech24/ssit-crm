import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/goals/[id]/email — email the client their DETAILED goal-plan PDF
 * (renderGoalPdf) through the firm's own mailbox. Returns { ok, externalId }.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, can } from "@/lib/auth/rbac";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { goals, investors, tenants, communications } from "@/db/schema";
import { getConsent } from "@/lib/comms/pipeline";
import { emailAdapter } from "@/lib/comms/adapters/resend";
import { resolveEmailSender } from "@/lib/comms/sender";
import { emailLogoHeaderHtml } from "@/lib/comms/email-logo";
import { renderGoalPdf } from "@/lib/goal-planning/goal-pdf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const esc = (s: string) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    // Emailing a client is a managed action — gate it (this route was open to
    // ANY logged-in user) and, for non-managers, scope to the goal's own RM.
    requireCap(session.roles, "goal.manage", session.permissions);
    const canViewAll = can(session.roles, "investor.view.all", session.permissions);
    const meta = clientMetaFromHeaders(req.headers);

    const ctx = await withTenant(session.tenantId, async (tx) => {
      const [goal] = await tx.select().from(goals).where(and(eq(goals.id, id), eq(goals.tenantId, session.tenantId))).limit(1);
      if (!goal) return { error: "not_found" as const };
      const [inv] = await tx.select().from(investors).where(eq(investors.id, goal.investorId)).limit(1);
      // Ownership: an RM may only email their own clients' plans.
      if (!canViewAll && inv && inv.rmId !== session.userId) return { error: "forbidden" as const };
      // Compliance: this path doesn't go through dispatch(), so enforce the same
      // opt-out rule the pipeline does — never email a client who has REVOKED
      // transactional email consent.
      if (inv) {
        const consent = await getConsent(tx, session.tenantId, goal.investorId, "email", "transactional");
        if (consent && consent.status === "revoked") return { error: "opted_out" as const };
      }
      const [t] = await tx.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);
      let sender: Awaited<ReturnType<typeof resolveEmailSender>>;
      sender = await resolveEmailSender(tx, session.tenantId, session.userId);
      return { goal, inv, tenant: t, sender };
    });

    if ("error" in ctx) {
      if (ctx.error === "forbidden") return NextResponse.json({ error: "this client isn't assigned to you" }, { status: 403 });
      if (ctx.error === "opted_out") return NextResponse.json({ error: "This client has opted out of emails." }, { status: 409 });
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    if (!ctx.inv?.email) {
      return NextResponse.json({ error: "This client has no email on file. Add an email to send the plan." }, { status: 400 });
    }
    if (!(ctx.sender.smtp?.host)) {
      return NextResponse.json(
        { error: "No email sender connected. Connect your firm's mailbox under Settings → Email (SMTP/IMAP) to send." },
        { status: 400 }
      );
    }

    let pdf: Buffer;
    try {
      pdf = await renderGoalPdf({
        goal: ctx.goal as any,
        refId: (ctx.goal as any)?.id ?? null,
        investor: { name: ctx.inv?.name },
        brand: {
          displayName: (ctx.tenant as any)?.displayName, legalName: (ctx.tenant as any)?.legalName,
          arn: (ctx.tenant as any)?.arn, euin: (ctx.tenant as any)?.euin,
          primaryColor: (ctx.tenant as any)?.primaryColor, secondaryColor: (ctx.tenant as any)?.secondaryColor,
          logoUrl: (ctx.tenant as any)?.logoUrl,
        },
      });
    } catch (e: any) {
      return NextResponse.json({ error: `Couldn't build the goal PDF: ${e?.message ?? "error"}` }, { status: 500 });
    }

    const firmName = (ctx.tenant as any)?.displayName ?? (ctx.tenant as any)?.legalName ?? "Your advisor";
    const goalName = (ctx.goal as any).name ?? "your goal";
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#0f172a;">
      ${emailLogoHeaderHtml((ctx.tenant as any)?.logoUrl, firmName)}
      <p>Dear ${esc(ctx.inv?.name ?? "Investor")},</p>
      <p>Please find your detailed goal plan for <strong>${esc(goalName)}</strong> attached as a PDF — it covers your target, the monthly SIP needed, and the projection based on the stated assumptions.</p>
      <p>Happy to walk you through it on a call.</p>
      <p style="margin-top:20px;">Warm regards,<br/><strong>${esc(firmName)}</strong></p>
      <p style="font-size:11px;color:#64748b;margin-top:20px;border-top:1px solid #e2e8f0;padding-top:10px;">Mutual fund investments are subject to market risks. Read all scheme related documents carefully.</p>
    </div>`;

    let externalId = "";
    try {
      const res = await emailAdapter.send({
        tenantId: session.tenantId,
        tokens: {},
        rendered: { subject: `Your goal plan — ${goalName}`, text: `Please find your goal plan for "${goalName}" attached.`, tokens: {} },
        recipient: ctx.inv.email,
        category: "transactional",
        inlineHtml: html,
        idempotencyKey: `goal:${id}`,
        smtp: ctx.sender.smtp,
        fromOverride: ctx.sender.fromEmail || undefined,
        fromNameOverride: ctx.sender.fromName || firmName,
        replyTo: ctx.sender.replyTo || undefined,
        attachments: [{ filename: `Goal-Plan-${String(goalName).replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 40)}.pdf`, content: pdf }],
      });
      externalId = res.externalId;
    } catch (e: any) {
      const m = String(e?.message ?? "");
      const friendly = /RESEND_API_KEY|EAUTH|invalid login|535|ECONNREFUSED|getaddrinfo|ETIMEDOUT|certificate|authentication/i.test(m)
        ? "Couldn't send — check your firm's email connection under Settings → Email (SMTP/IMAP)."
        : (m || "Could not send email");
      return NextResponse.json({ error: friendly }, { status: 502 });
    }

    try {
      await withTenant(session.tenantId, async (tx) => {
        await tx.insert(communications).values({
          tenantId: session.tenantId,
          investorId: (ctx.goal as any).investorId,
          userId: session.userId,
          channel: "email",
          direction: "outbound",
          status: "sent",
          externalId,
          payload: { kind: "goal_plan", goalId: id, recipient: ctx.inv!.email } as any,
          sentAt: new Date(),
        } as any);
        await recordAudit(tx, {
          tenantId: session.tenantId,
          actorUserId: session.userId,
          action: "goal.email",
          entityType: "goal",
          entityId: id,
          after: { to: ctx.inv!.email, externalId } as any,
          ...meta,
        });
      });
    } catch (e) {
      console.warn("[goal.email] sent but log failed:", (e as Error)?.message);
    }

    return NextResponse.json({ ok: true, externalId });
  } catch (err: any) {
    return handleApiError(err);
  }
}
