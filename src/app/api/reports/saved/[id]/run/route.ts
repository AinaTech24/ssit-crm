import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/reports/saved/[id]/run — execute a saved report, return JSON.
 * Supports ?limit & ?offset for detailed reports (paged in the view page).
 */
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { savedReports } from "@/db/schema";
import { runDetailed, runMatrix, runSummary } from "@/lib/reports/run";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "reports.manage", session.permissions);
    const url = new URL(req.url);
    const limit = parseInt(url.searchParams.get("limit") ?? "100", 10);
    const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);

    const out = await withTenant(session.tenantId, async (tx) => {
      const r = (await tx.select().from(savedReports).where(and(eq(savedReports.id, id), eq(savedReports.tenantId, session.tenantId))).limit(1))[0];
      if (!r) return null;
      if (r.reportType === "matrix") {
        return runMatrix(tx, { subject: r.subject, ast: r.ast as any, matrix: r.matrix as any, tenantId: session.tenantId });
      }
      if (r.reportType === "summary") {
        return runSummary(tx, { subject: r.subject, ast: r.ast as any, summary: r.summary as any, tenantId: session.tenantId });
      }
      return runDetailed(tx, {
        subject: r.subject,
        ast: r.ast as any,
        columns: r.columns as string[] | null,
        sort: r.sort as any,
        tenantId: session.tenantId,
        limit,
        offset,
      });
    });
    if (!out) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ result: out });
  } catch (err: any) {
    return handleApiError(err);
  }
}
