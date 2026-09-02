import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/reports/saved/[id]/clone — duplicate a report into a private copy
 * owned by the caller (Zoho "Clone"). The clone opens independently; editing it
 * never touches the original.
 */
import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { savedReports } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "reports.manage", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const clientMeta = clientMetaFromHeaders(req.headers);

    const newId = await withTenant(session.tenantId, async (tx) => {
      const src = (await tx.select().from(savedReports).where(and(eq(savedReports.id, id), eq(savedReports.tenantId, session.tenantId))).limit(1))[0];
      if (!src) return null;
      const cid = uuid();
      await tx.insert(savedReports).values({
        id: cid,
        tenantId: session.tenantId,
        branchId: session.branchId ?? null,
        name: `${src.name} (copy)`.slice(0, 160),
        description: src.description,
        subject: src.subject,
        reportType: src.reportType,
        ast: src.ast as any,
        columns: src.columns as any,
        sort: src.sort as any,
        matrix: src.matrix as any,
        summary: src.summary as any,
        folder: src.folder,
        chartType: src.chartType,
        sharedScope: "private", // a clone starts private to its creator
        schedule: null, // never copy a schedule — avoids surprise duplicate emails
        createdById: session.userId,
        starredBy: [],
      } as any);
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "report.clone",
        entityType: "saved_report",
        entityId: cid,
        after: { name: `${src.name} (copy)`, clonedFrom: id },
        ...clientMeta,
      });
      return cid;
    });
    if (!newId) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ id: newId }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
