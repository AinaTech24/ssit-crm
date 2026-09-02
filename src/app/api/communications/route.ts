import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/communications
 *
 * JSON list feed for the mobile app — mirrors the web CRM's Communications
 * (unified inbox/outbox) page. Returns the ~100 most recent messages for the
 * tenant with the fields a message row shows. Read-only; RLS-scoped via
 * withTenant. No filters in v1.
 */

import { NextResponse } from "next/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { communications, investors, leads } from "@/db/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LIMIT = 100;

export async function GET() {
  try {
    const session = await requireSession();
    // Messages carry client/lead PII. Managers see all; everyone else only
    // messages tied to a client they manage (investors.rm_id) or a lead they own.
    const seesAll =
      can(session.roles, "investor.view.all", session.permissions) ||
      can(session.roles, "compliance.view", session.permissions);
    const scope = seesAll
      ? undefined
      : sql`(${communications.investorId} IN (SELECT id FROM investors WHERE rm_id = ${session.userId}::uuid)
             OR ${communications.leadId} IN (SELECT id FROM leads WHERE owner_id = ${session.userId}::uuid))`;

    const rows = await withTenant(
      session.tenantId,
      async (tx) => {
        return tx
          .select({
            id: communications.id,
            channel: communications.channel,
            direction: communications.direction,
            status: communications.status,
            payload: communications.payload,
            inboundContent: communications.inboundContent,
            templateKey: communications.templateKey,
            createdAt: communications.createdAt,
            investorName: investors.name,
            leadName: leads.name,
          })
          .from(communications)
          .leftJoin(investors, eq(investors.id, communications.investorId))
          .leftJoin(leads, eq(leads.id, communications.leadId))
          .where(and(eq(communications.tenantId, session.tenantId), scope))
          .orderBy(desc(communications.createdAt), desc(communications.id))
          .limit(LIMIT);
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    const communicationsOut = rows.map((r) => {
      const payload = (r.payload ?? {}) as any;
      const inbound = (r.inboundContent ?? {}) as any;
      const subject: string = payload?.rendered?.subject ?? "";
      const preview = String(payload?.rendered?.text ?? inbound?.text ?? "").slice(0, 160);
      return {
        id: r.id,
        channel: r.channel,
        direction: r.direction,
        status: r.status,
        preview,
        subject,
        name: r.investorName ?? r.leadName ?? payload?.recipient ?? r.templateKey ?? "—",
        createdAt: r.createdAt.toISOString(),
      };
    });

    return NextResponse.json({ communications: communicationsOut });
  } catch (err) {
    return handleApiError(err);
  }
}
