/**
 * GET /api/compliance — JSON feed for the mobile Compliance screen.
 *
 * Mirrors the web /dashboard/compliance RSC: the DDQ readiness score + breakdown
 * (computed live via calculateDdqScore — the same helper the page uses), the
 * expiry watchlist (ARN / NISM / EUIN / CKYC), templates pending approval, and
 * the recent audit trail. Management-only (owner / compliance / branch_head).
 */

import { handleApiError } from "@/lib/api/error-handler";
import { NextResponse } from "next/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { templates, templateVersions, auditLog, users, tenants } from "@/db/schema";
import { calculateDdqScore } from "@/lib/compliance/ddq-calculator";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function getDaysRemaining(dateish: string | Date | null | undefined): number | null {
  if (!dateish) return null;
  const d = new Date(dateish);
  if (isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86_400_000);
}

export async function GET() {
  try {
    const session = await requireSession();
    if (!session.roles.some((r: string) => ["owner", "compliance", "branch_head"].includes(r))) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const result = await withTenant(
      session.tenantId,
      async (tx) => {
        const ddq = await calculateDdqScore(tx, session.tenantId);

        const pending = await tx
          .select({
            id: templates.id,
            name: templates.name,
            key: templates.key,
            versionNumber: templateVersions.versionNumber,
          })
          .from(templates)
          .innerJoin(templateVersions, eq(templateVersions.id, templates.currentVersionId))
          .where(and(eq(templates.tenantId, session.tenantId), eq(templateVersions.approvalStatus, "submitted")));

        const tenantRow = (
          await tx
            .select({ arnExpiryAt: tenants.arnExpiryAt, displayName: tenants.displayName })
            .from(tenants)
            .where(eq(tenants.id, session.tenantId))
            .limit(1)
        )[0];

        const activeUsers = await tx
          .select({ name: users.name, nismExpiryAt: users.nismExpiryAt, euinExpiryAt: users.euinExpiryAt })
          .from(users)
          .where(and(eq(users.tenantId, session.tenantId), eq(users.status, "active" as any)));

        const expiringInvestors = (
          await tx.execute(sql`
            SELECT name, ckyc_expiry_at FROM investors
            WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active' AND ckyc_expiry_at IS NOT NULL
            ORDER BY ckyc_expiry_at ASC LIMIT 3
          `)
        ).rows as any[];

        const recentLogs = await tx
          .select({
            id: auditLog.id,
            action: auditLog.action,
            actorType: auditLog.actorType,
            at: auditLog.at,
            actorName: users.name,
          })
          .from(auditLog)
          .leftJoin(users, eq(users.id, auditLog.actorUserId))
          .orderBy(desc(auditLog.at))
          .limit(10);

        return { ddq, pending, tenantRow, activeUsers, expiringInvestors, recentLogs };
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    const watchlist: { type: string; who: string; when: string; urgent: boolean; days: number }[] = [];
    const push = (type: string, who: string, dateish: any) => {
      const days = getDaysRemaining(dateish);
      if (days !== null) watchlist.push({ type, who, when: days < 0 ? "Expired" : `${days} days`, urgent: days < 30, days });
    };
    if (result.tenantRow?.arnExpiryAt) push("ARN (Firm)", result.tenantRow.displayName || "Firm Profile", result.tenantRow.arnExpiryAt);
    for (const u of result.activeUsers) {
      if (u.nismExpiryAt) push("NISM Certificate", `${u.name} (RM)`, u.nismExpiryAt);
      if (u.euinExpiryAt) push("EUIN Validity", `${u.name} (RM)`, u.euinExpiryAt);
    }
    for (const inv of result.expiringInvestors) {
      if (inv.ckyc_expiry_at) push("CKYC Certificate", inv.name, inv.ckyc_expiry_at);
    }
    watchlist.sort((a, b) => a.days - b.days);

    return NextResponse.json({
      ddqScore: { overallScore: result.ddq.overallScore, breakdown: result.ddq.breakdown },
      watchlist,
      pendingApprovals: result.pending,
      auditTrail: result.recentLogs,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
