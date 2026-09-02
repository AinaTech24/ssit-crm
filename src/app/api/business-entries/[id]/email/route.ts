import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/business-entries/[id]/email — email the client a transactional
 * confirmation summarising the booked business. Uses the firm's own email
 * sender (SMTP / Resend) via the email adapter; marks the entry 'emailed'.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { businessEntries, businessEntryLines, investors } from "@/db/schema";
import { emailAdapter } from "@/lib/comms/adapters/resend";
import { resolveEmailSender } from "@/lib/comms/sender";
import { loadTenant, getConsent } from "@/lib/comms/pipeline";
import { renderBusinessEmail } from "@/lib/business/email";

export const dynamic = "force-dynamic";

const MANAGE_ROLES = ["owner", "branch_head", "rm", "back_office", "ops"];
const seesAllEntries = (s: { roles: string[]; permissions?: string[] | null }) =>
  can(s.roles, "investor.view.all", s.permissions) || can(s.roles, "reports.business", s.permissions);

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    if (!session.roles.some((r) => MANAGE_ROLES.includes(r))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const meta = clientMetaFromHeaders(req.headers);

    let ctx;
    try {
      ctx = await withTenant(session.tenantId, async (tx) => {
        const [entry] = await tx
          .select()
          .from(businessEntries)
          .where(and(eq(businessEntries.id, id), eq(businessEntries.tenantId, session.tenantId)))
          .limit(1);
        if (!entry) return { error: "not_found" as const };
        // RMs may only email confirmations for their own bookings.
        if (!seesAllEntries(session) && entry.rmId !== session.userId) return { error: "forbidden" as const };
        const lines = await tx
          .select()
          .from(businessEntryLines)
          .where(eq(businessEntryLines.entryId, id))
          .orderBy(asc(businessEntryLines.sortOrder));

        let email: string | null = null;
        if (entry.investorId) {
          const [inv] = await tx.select({ email: investors.email }).from(investors).where(eq(investors.id, entry.investorId)).limit(1);
          email = inv?.email ?? null;
          // This path doesn't go through dispatch(), so enforce the same opt-out
          // rule the comms pipeline does — never email a client who has REVOKED
          // transactional email consent.
          const consent = await getConsent(tx, session.tenantId, entry.investorId, "email", "transactional");
          if (consent && consent.status === "revoked") return { error: "opted_out" as const };
        }
        // Use the shared loader (Drizzle select, RLS-safe) — the tenants table
        // has no "name" column (it's display_name / legal_name), which is what
        // made the old raw SELECT throw.
        const firm = await loadTenant(tx, session.tenantId);
        // Resolve the firm's OWN mailbox (sending RM → firm SMTP/OAuth → Resend)
        // so the confirmation genuinely leaves from the firm's inbox. A mailbox
        // hiccup (OAuth refresh / decrypt / unknown provider) must NOT abort the
        // send and surface as a masked "internal" — fall back to Resend.
        let sender: Awaited<ReturnType<typeof resolveEmailSender>>;
        try {
          sender = await resolveEmailSender(tx, session.tenantId, session.userId);
        } catch (e) {
          console.error("[business_entry.email] sender resolve failed — falling back to Resend:", (e as Error)?.message);
          sender = { source: "resend" };
        }
        return {
          entry,
          lines,
          email,
          firmName: firm?.displayName ?? firm?.legalName ?? "Your advisor",
          firmLogoUrl: firm?.logoUrl ?? null,
          firmArn: firm?.arn ?? null,
          sender,
        };
      });
    } catch (e: any) {
      console.error("[business_entry.email] prepare failed:", e?.stack || e?.message || e);
      return NextResponse.json(
        { error: `Couldn't prepare the email — ${String(e?.message ?? "please try again").slice(0, 160)}` },
        { status: 502 }
      );
    }

    if ("error" in ctx) {
      if (ctx.error === "forbidden") return NextResponse.json({ error: "you can only email entries you booked" }, { status: 403 });
      if (ctx.error === "opted_out") return NextResponse.json({ error: "This client has opted out of emails." }, { status: 409 });
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    if (!ctx.email) {
      return NextResponse.json({ error: "This client has no email on file. Link a client with an email to send." }, { status: 400 });
    }

    // Build the email (guarded so a render hiccup can't masquerade as "internal").
    let subject = "", text = "", html = "";
    try {
      const r = renderBusinessEmail({
        clientName: ctx.entry.clientName,
        firmName: ctx.firmName,
        productType: ctx.entry.productType,
        businessDate: String(ctx.entry.businessDate),
        total: ctx.entry.totalAmount,
        lines: ctx.lines.map((l) => ({ schemeName: l.schemeName, txnType: l.txnType, amount: l.amount, frequency: l.frequency, fromSchemeName: l.fromSchemeName })),
        logoUrl: ctx.firmLogoUrl,
        arn: ctx.firmArn,
      });
      subject = r.subject; text = r.text; html = r.html;
    } catch {
      return NextResponse.json({ error: "Could not build the email content." }, { status: 500 });
    }

    // No mailbox connected and no platform Resend key → tell the user how to fix
    // it, instead of throwing a masked 500.
    const sender = ctx.sender;
    const canSend = !!(sender.smtp?.host || sender.apiKey || process.env.RESEND_API_KEY);
    if (!canSend) {
      return NextResponse.json(
        { error: "No email sender connected. Connect your firm's mailbox under Settings → Email (SMTP/IMAP) to send client emails." },
        { status: 400 }
      );
    }

    let externalId = "";
    try {
      const res = await emailAdapter.send({
        tenantId: session.tenantId,
        tokens: {},
        rendered: { subject, text, tokens: {} },
        recipient: ctx.email,
        category: "transactional",
        inlineHtml: html,
        idempotencyKey: `business-entry:${id}`,
        // Route through the firm's own mailbox when present (authentic From +
        // replies land in their inbox); Resend is the last-resort fallback.
        smtp: sender.smtp,
        apiKey: sender.apiKey,
        fromOverride: sender.fromEmail || undefined,
        fromNameOverride: sender.fromName || ctx.firmName,
        replyTo: sender.replyTo || undefined,
      });
      externalId = res.externalId;
    } catch (e: any) {
      const m = String(e?.message ?? "");
      const friendly =
        /RESEND_API_KEY|no .*sender|EAUTH|invalid login|535|ECONNREFUSED|getaddrinfo|ETIMEDOUT|self.signed|certificate|authentication/i.test(m)
          ? "Couldn't send — check your firm's email connection under Settings → Email (SMTP/IMAP)."
          : (m || "Could not send email");
      return NextResponse.json({ error: friendly }, { status: 502 });
    }

    // Email already went out — stamp the entry best-effort; never fail the
    // request (or surface "internal") just because the status update hiccuped.
    try {
      await withTenant(session.tenantId, async (tx) => {
        await tx
          .update(businessEntries)
          .set({ status: "emailed", emailedAt: new Date(), updatedAt: new Date() } as any)
          .where(and(eq(businessEntries.id, id), eq(businessEntries.tenantId, session.tenantId)));
        await recordAudit(tx, {
          tenantId: session.tenantId,
          actorUserId: session.userId,
          action: "business_entry.email",
          entityType: "business_entry",
          entityId: id,
          after: { to: ctx.email, externalId, via: sender.source } as any,
          ...meta,
        });
      });
    } catch (e) {
      console.warn("[business_entry.email] sent but status stamp failed:", (e as Error)?.message);
    }

    return NextResponse.json({ ok: true, externalId, via: sender.source });
  } catch (err: any) {
    return handleApiError(err);
  }
}
