import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/business-expenses/budgets  — per-category monthly budgets
 * PUT /api/business-expenses/budgets  — upsert budgets { budgets: {category: amount} }
 *
 * Gated by `reports.commission`. Tenant-scoped via RLS.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, requireAny } from "@/lib/auth/rbac";
import { expenseBudgets, EXPENSE_CATEGORIES } from "@/db/schema";

export const dynamic = "force-dynamic";

const PutBody = z.object({
  budgets: z.record(z.enum(EXPENSE_CATEGORIES), z.number().min(0).max(1_000_000_000)),
});

export async function GET() {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["finances.view", "expense.manage"], session.permissions);
    const rows = await withTenant(session.tenantId, (tx) =>
      tx.select().from(expenseBudgets).where(eq(expenseBudgets.tenantId, session.tenantId))
    );
    const budgets: Record<string, number> = {};
    for (const r of rows) budgets[r.category] = Number(r.monthlyBudget);
    return NextResponse.json({ budgets });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["finances.view", "expense.manage"], session.permissions);
    const parsed = PutBody.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const entries = Object.entries(parsed.data.budgets);
    await withTenant(session.tenantId, async (tx) => {
      for (const [category, amount] of entries) {
        await tx.execute(sql`
          INSERT INTO expense_budgets (tenant_id, category, monthly_budget, updated_by, updated_at)
          VALUES (${session.tenantId}, ${category}, ${amount}, ${session.userId}, now())
          ON CONFLICT (tenant_id, category)
          DO UPDATE SET monthly_budget = EXCLUDED.monthly_budget, updated_by = EXCLUDED.updated_by, updated_at = now()
        `);
      }
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
