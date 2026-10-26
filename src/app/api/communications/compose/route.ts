import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/communications/compose
 *
 * Ad-hoc 1:1 client email. Routes through the same consent + compliance gate as
 * every other send (via src/lib/comms/compose.ts) and lands an audited
 * `communications` row. Send now, or schedule for later.
 *
 * Recipient: an investorId or leadId (resolves the email + applies consent), or
 * a raw email address (no consent record → flagged, allowed).
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, can } from "@/lib/auth/rbac";
import { assertCanViewClient } from "@/lib/investors/access";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { investors, leads } from "@/db/schema";
import { composeAndSendEmail, scheduleEmail } from "@/lib/comms/compose";

export const dynamic = "force-dynamic";

const Body = z
  .object({
    investorId: z.string().uuid().optional(),
    leadId: z.string().uuid().optional(),
    toEmail: z.string().email().optional(),
    subject: z.string().min(1).max(300),
    body: z.string().min(1).max(20000),
    category: z.enum(["transactional", "marketing"]).default("transactional"),
    /** ISO datetime; when present + future → scheduled instead of sent now. */
    scheduledAt: z.string().datetime().optional(),
  })
  .refine((b) => b.investorId || b.leadId || b.toEmail, {
    message: "one of investorId / leadId / toEmail is required",
  });

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "communication.send", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const b = parsed.data;
    const clientMeta = clientMetaFromHeaders(req.headers);

    // Managers / ops / compliance may compose to any client in the firm; a plain
    // RM (or marketing) may only email their own clients / leads.
    const seesAll =
      can(session.roles, "investor.view.all", session.permissions) ||
      can(session.roles, "compliance.view", session.permissions) ||
      can(session.roles, "reports.business", session.permissions);

    const scheduledAt = b.scheduledAt ? new Date(b.scheduledAt) : null;
    if (scheduledAt && scheduledAt.getTime() <= Date.now()) {
      return NextResponse.json({ error: "scheduledAt must be in the future" }, { status: 400 });
    }

    const out = await withTenant(session.tenantId, async (tx) => {
      // Resolve recipient email + display name.
      let recipient = b.toEmail ?? "";
      let recipientName: string | null = null;
      if (b.investorId) {
        // Tenant predicate is the live cross-tenant guard (RLS-bypass model) —
        // mirror the sibling actions route. Pull rmId to enforce own-client scope.
        const [inv] = await tx
          .select({ id: investors.id, email: investors.email, name: investors.name, rmId: investors.rmId, serviceRmId: investors.serviceRmId })
          .from(investors)
          .where(and(eq(investors.id, b.investorId), eq(investors.tenantId, session.tenantId)))
          .limit(1);
        if (!inv) throw Object.assign(new Error("investor not found"), { status: 404 });
        if (!seesAll) {
          try {
            await assertCanViewClient(tx, session, inv);
          } catch {
            throw Object.assign(new Error("not your client"), { status: 403 });
          }
        }
        if (!inv.email) throw Object.assign(new Error("investor has no email on file"), { status: 400 });
        recipient = inv.email;
        recipientName = inv.name;
      } else if (b.leadId) {
        const [ld] = await tx
          .select({ email: leads.email, name: leads.name, ownerId: leads.ownerId })
          .from(leads)
          .where(and(eq(leads.id, b.leadId), eq(leads.tenantId, session.tenantId)))
          .limit(1);
        if (!ld) throw Object.assign(new Error("lead not found"), { status: 404 });
        if (!seesAll && ld.ownerId !== session.userId) {
          throw Object.assign(new Error("not your lead"), { status: 403 });
        }
        if (!ld.email) throw Object.assign(new Error("lead has no email on file"), { status: 400 });
        recipient = ld.email;
        recipientName = ld.name;
      }

      const input = {
        tenantId: session.tenantId,
        subject: b.subject,
        body: b.body,
        category: b.category,
        recipient,
        recipientName,
        investorId: b.investorId ?? null,
        leadId: b.leadId ?? null,
        actorUserId: session.userId,
      };

      const result = scheduledAt
        ? await scheduleEmail(tx, input, scheduledAt)
        : await composeAndSendEmail(tx, input);

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: scheduledAt ? "communication.schedule" : "communication.send",
        entityType: "communication",
        entityId: result.communicationId || "—",
        after: { channel: "email", recipient, category: b.category, status: result.status, subject: b.subject },
        ...clientMeta,
      });

      return result;
    });

    // A compliance block is a real, expected outcome — surface it as 422 so the
    // compose UI can show the findings rather than treating it as a 500.
    if (out.status === "skipped" && out.reason === "skipped_compliance") {
      return NextResponse.json({ error: "blocked by compliance", findings: out.findings, ...out }, { status: 422 });
    }
    return NextResponse.json(out, { status: out.status === "scheduled" ? 201 : 200 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
