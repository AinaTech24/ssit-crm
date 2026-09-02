import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET  /api/business-expenses?fy=YYYY-YY  — list firm expenses for a fiscal year
 * POST /api/business-expenses             — create an expense (8.2 ledger)
 *
 * Firm-money data (P&L incl. team salaries) — gated by `finances.view`
 * (owner + back-office only). Tenant-scoped via withTenant + RLS.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { businessExpenses, EXPENSE_CATEGORIES, PAID_FROM } from "@/db/schema";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { fyBounds } from "@/lib/finance/fiscal-year";

export const dynamic = "force-dynamic";

const PostBody = z.object({
  expenseDate: z.string().min(8), // ISO date
  description: z.string().min(1).max(300),
  category: z.enum(EXPENSE_CATEGORIES),
  paidFrom: z.enum(PAID_FROM),
  amount: z.number().positive().max(1_000_000_000),
  notes: z.string().max(1000).optional(),
});

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "finances.view", session.permissions);
    const fy = req.nextUrl.searchParams.get("fy") ?? undefined;
    const bounds = fy ? fyBounds(fy) : null;

    const rows = await withTenant(session.tenantId, async (tx) => {
      const conds = [eq(businessExpenses.tenantId, session.tenantId)];
      if (bounds) {
        conds.push(gte(businessExpenses.expenseDate, bounds.startISO));
        conds.push(lte(businessExpenses.expenseDate, bounds.endISO));
      }
      return tx
        .select()
        .from(businessExpenses)
        .where(and(...conds))
        .orderBy(desc(businessExpenses.expenseDate), desc(businessExpenses.createdAt))
        .limit(1000);
    });

    return NextResponse.json({ expenses: rows });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "finances.view", session.permissions);
    const parsed = PostBody.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid body", issues: parsed.error.issues },
        { status: 400 }
      );
    }
    const d = parsed.data;
    const meta = clientMetaFromHeaders(req.headers);

    const row = await withTenant(session.tenantId, async (tx) => {
      const [created] = await tx
        .insert(businessExpenses)
        .values({
          tenantId: session.tenantId,
          expenseDate: d.expenseDate.slice(0, 10),
          description: d.description,
          category: d.category,
          paidFrom: d.paidFrom,
          amount: String(d.amount),
          notes: d.notes ?? null,
          createdBy: session.userId,
        } as any)
        .returning();
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "business_expense.create",
        entityType: "business_expense",
        entityId: created.id,
        after: created as any,
        ...meta,
      });
      return created;
    });

    return NextResponse.json({ expense: row });
  } catch (err: any) {
    return handleApiError(err);
  }
}
