import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { eventsOutbox, investors, serviceRequests } from "@/db/schema";
import { resolvePortalAccess } from "@/lib/portal/access";
import { recordAudit } from "@/lib/audit";
import { handleApiError } from "@/lib/api/error-handler";

export const dynamic = "force-dynamic";

const Body = z.object({
  type: z.enum(["statement_request", "capital_gain_report", "nominee_update", "bank_update", "kyc_update", "other"]),
  subject: z.string().trim().min(3).max(160),
  description: z.string().trim().max(2000).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const access = await resolvePortalAccess(token, false);
    if (!access || !access.scopes.includes("service_requests")) {
      return NextResponse.json({ error: "invalid or expired portal link" }, { status: 401 });
    }
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "invalid input", issues: parsed.error.issues }, { status: 400 });

    const result = await withTenant(access.tenantId, async (tx) => {
      const [investor] = await tx
        .select({ name: investors.name, rmId: investors.rmId })
        .from(investors)
        .where(eq(investors.id, access.investorId))
        .limit(1);
      if (!investor) return null;

      const [open] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(serviceRequests)
        .where(
          and(
            eq(serviceRequests.investorId, access.investorId),
            inArray(serviceRequests.status, ["open", "in_progress", "waiting_customer", "escalated"])
          )
        );
      if ((open?.count ?? 0) >= 5) return { limited: true as const };

      const [seq] = await tx.execute(sql`
        SELECT COUNT(*)::int + 1 AS n
        FROM service_requests
        WHERE tenant_id = ${access.tenantId}::uuid
          AND created_at >= date_trunc('year', now())
      `).then((r) => r.rows as Array<{ n: number }>);
      const ticketNo = `SR-${new Date().getFullYear()}-${String(Number(seq?.n ?? 1)).padStart(5, "0")}`;
      const id = uuid();
      const now = new Date();
      const slaResolutionAt = new Date(now.getTime() + 7 * 86_400_000);
      const slaResponseAt = new Date(now.getTime() + 24 * 3_600_000);

      await tx.insert(serviceRequests).values({
        id,
        tenantId: access.tenantId,
        investorId: access.investorId,
        assignedToUserId: investor.rmId,
        ticketNo,
        type: parsed.data.type,
        channel: "form",
        subject: parsed.data.subject,
        description: parsed.data.description,
        status: "open",
        priority: "normal",
        slaResponseAt,
        slaResolutionAt,
        timeline: [{ at: now.toISOString(), by: "client_portal", event: "created", note: `Submitted by ${investor.name}` }],
      });
      await tx.insert(eventsOutbox).values({
        tenantId: access.tenantId,
        kind: "service_request.created",
        entityType: "service_request",
        entityId: id,
        after: { ticketNo, type: parsed.data.type, priority: "normal", source: "investor_portal" },
        meta: { investorId: access.investorId, portalAccessId: access.id },
      });
      await recordAudit(tx, {
        tenantId: access.tenantId,
        actorType: "system",
        action: "service_request.portal_create",
        entityType: "service_request",
        entityId: id,
        after: { ticketNo, type: parsed.data.type, investorId: access.investorId },
        reason: "Submitted through an expiring investor portal link",
      });
      return { limited: false as const, ticketNo };
    });

    if (!result) return NextResponse.json({ error: "client not found" }, { status: 404 });
    if (result.limited) return NextResponse.json({ error: "Please wait for the firm to resolve an open request before adding another." }, { status: 429 });
    return NextResponse.json({ ticketNo: result.ticketNo }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

