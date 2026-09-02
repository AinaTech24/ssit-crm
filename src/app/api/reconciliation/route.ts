/**
 * GET /api/reconciliation[?status=open,investigating] — JSON feed for the mobile
 * Reconciliation screen. Mirrors the web /dashboard/reconciliation RSC: headline
 * stats (open breaks, high severity, ₹ exposure, resolved), the last run time,
 * and the break list (worst first). Read-only; the run/resolve actions stay on
 * their existing POST/PATCH endpoints.
 */

import { handleApiError } from "@/lib/api/error-handler";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const statusFilter = (req.nextUrl.searchParams.get("status") ?? "open,investigating").split(",").filter(Boolean);

    const data = await withTenant(
      session.tenantId,
      async (tx) => {
        const conds: any[] = [sql`e.tenant_id = ${session.tenantId}::uuid`];
        if (statusFilter.length) conds.push(sql`e.status IN (${sql.join(statusFilter.map((v) => sql`${v}`), sql`, `)})`);
        const whereSql = sql.join(conds, sql` AND `);

        const rows = await tx.execute(sql`
          SELECT e.id, e.investor_id, i.name AS investor_name, e.scheme_code, e.scheme_name, e.folio_number,
                 e.exception_type, e.severity, e.status,
                 e.crm_units, e.feed_units, e.delta_units, e.delta_value, e.detected_at
          FROM reconciliation_exceptions e
          LEFT JOIN investors i ON i.id = e.investor_id
          WHERE ${whereSql}
          ORDER BY (e.severity = 'high') DESC, ABS(COALESCE(e.delta_value,0)) DESC, e.detected_at DESC
          LIMIT 100
        `);

        const stats = await tx.execute(sql`
          SELECT
            COUNT(*) FILTER (WHERE status IN ('open','investigating'))::int AS open,
            COUNT(*) FILTER (WHERE status IN ('open','investigating') AND severity = 'high')::int AS high,
            COALESCE(SUM(ABS(delta_value)) FILTER (WHERE status IN ('open','investigating')), 0)::numeric AS exposure,
            COUNT(*) FILTER (WHERE status = 'resolved')::int AS resolved
          FROM reconciliation_exceptions WHERE tenant_id = ${session.tenantId}::uuid
        `);
        const lastRun = await tx.execute(sql`
          SELECT run_at, exceptions_found FROM reconciliation_runs
          WHERE tenant_id = ${session.tenantId}::uuid ORDER BY run_at DESC LIMIT 1
        `);

        return { exceptions: rows.rows as any[], stats: (stats.rows[0] ?? {}) as any, lastRun: (lastRun.rows[0] ?? null) as any };
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    return NextResponse.json(data);
  } catch (err) {
    return handleApiError(err);
  }
}
