import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/transactions
 *
 * JSON feed for the mobile app's Transactions list — mirrors the web CRM
 * Transactions page (src/app/dashboard/transactions/page.tsx). Simplified: no
 * cursor pagination and no filters for v1 — returns the ~100 most recent
 * transactions for the tenant, newest first. RLS scopes to the tenant.
 */

import { NextResponse } from "next/server";
import { desc, eq, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { transactions, investors } from "@/db/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await requireSession();
    // Transactions expose client holdings/amounts. Managers see all; everyone
    // else only transactions for a client they manage (investors.rm_id).
    const seesAll =
      can(session.roles, "investor.view.all", session.permissions) ||
      can(session.roles, "compliance.view", session.permissions);
    const scope = seesAll
      ? undefined
      : sql`${transactions.investorId} IN (SELECT id FROM investors WHERE rm_id = ${session.userId}::uuid)`;

    const rows = await withTenant(
      session.tenantId,
      async (tx) => {
        const list = await tx
          .select({
            id: transactions.id,
            schemeName: transactions.schemeName,
            amcName: transactions.amcName,
            amount: transactions.amount,
            direction: transactions.direction,
            type: transactions.type,
            status: transactions.status,
            orderDate: transactions.orderDate,
            folioNumber: transactions.folioNumber,
            investorId: transactions.investorId,
            investorName: investors.name,
          })
          .from(transactions)
          .leftJoin(investors, eq(investors.id, transactions.investorId))
          .where(scope)
          .orderBy(
            desc(transactions.orderDate),
            desc(transactions.createdAt),
            desc(transactions.id)
          )
          .limit(100);

        return list.map((r) => ({
          id: r.id,
          schemeName: r.schemeName ?? null,
          amcName: r.amcName ?? null,
          amount: r.amount != null ? Number(r.amount) : null,
          direction: r.direction,
          type: r.type,
          status: r.status,
          orderDate: r.orderDate ?? null,
          folioNumber: r.folioNumber ?? null,
          investorId: r.investorId,
          investorName: r.investorName ?? null,
        }));
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    return NextResponse.json({ rows });
  } catch (err) {
    return handleApiError(err);
  }
}
