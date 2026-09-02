import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET  /api/discovery            — list discoveries (newest first)
 * POST /api/discovery            — create a draft for a lead/investor (prefills
 *                                  identity from the subject record)
 *
 * Gated to anyone who can see leads or clients. Tenant-scoped via RLS.
 */

import { NextRequest, NextResponse } from "next/server";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { financialDiscoveries } from "@/db/schema";

export const dynamic = "force-dynamic";

const VIEW_CAPS = ["investor.view.all", "investor.view.assigned", "lead.view.all", "lead.view.assigned"] as const;

const PostBody = z.object({
  subjectType: z.enum(["lead", "investor"]),
  subjectId: z.string().uuid(),
  reviewType: z.string().max(80).optional(),
});

export async function GET() {
  try {
    const session = await requireSession();
    requireAny(session.roles, [...VIEW_CAPS], session.permissions);
    const rows = await withTenant(session.tenantId, (tx) =>
      tx
        .select({
          id: financialDiscoveries.id,
          subjectType: financialDiscoveries.subjectType,
          subjectId: financialDiscoveries.subjectId,
          title: financialDiscoveries.title,
          status: financialDiscoveries.status,
          reviewType: financialDiscoveries.reviewType,
          healthScore: financialDiscoveries.healthScore,
          updatedAt: financialDiscoveries.updatedAt,
          submittedAt: financialDiscoveries.submittedAt,
        })
        .from(financialDiscoveries)
        .orderBy(desc(financialDiscoveries.updatedAt))
        .limit(300)
    );
    return NextResponse.json({ discoveries: rows });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireAny(session.roles, [...VIEW_CAPS], session.permissions);
    const parsed = PostBody.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const { subjectType, subjectId, reviewType } = parsed.data;

    const created = await withTenant(session.tenantId, async (tx) => {
      // Prefill identity from the subject (tolerant — only common columns).
      const table = subjectType === "lead" ? "leads" : "investors";
      const subj = (
        await tx.execute(sql`
          SELECT name, email, phone FROM ${sql.raw(table)}
          WHERE id = ${subjectId}::uuid AND tenant_id = ${session.tenantId}::uuid LIMIT 1
        `)
      ).rows[0] as any;
      const identification = subj
        ? { fullName: subj.name ?? "", email: subj.email ?? "", mobile: subj.phone ?? "" }
        : {};

      const [row] = await tx
        .insert(financialDiscoveries)
        .values({
          tenantId: session.tenantId,
          subjectType,
          subjectId,
          title: subj?.name ?? null,
          reviewType: reviewType ?? null,
          status: "draft",
          data: { identification } as any,
          computed: {} as any,
          assignedRmId: session.userId,
          createdBy: session.userId,
        } as any)
        .returning({ id: financialDiscoveries.id });
      return row;
    });

    return NextResponse.json({ id: created.id });
  } catch (err: any) {
    return handleApiError(err);
  }
}
