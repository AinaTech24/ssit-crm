import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET  /api/business-expenses/recurring  — list recurring expense templates
 * POST /api/business-expenses/recurring  — { op: "create", ... } create a template
 *                                          { op: "post-month", period } post the
 *                                          month's recurring expenses to the ledger
 *
 * Firm-money data — gated by `reports.commission`. Tenant-scoped via RLS.
 * Posting is idempotent: the partial unique index on
 * (tenant_id, recurring_id, recurring_period) means re-running a month is a no-op.
 */

import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, requireAny } from "@/lib/auth/rbac";
import { recurringExpenses, EXPENSE_CATEGORIES, PAID_FROM } from "@/db/schema";

export const dynamic = "force-dynamic";

const CreateBody = z.object({
  op: z.literal("create"),
  description: z.string().min(1).max(300),
  category: z.enum(EXPENSE_CATEGORIES),
  paidFrom: z.enum(PAID_FROM),
  amount: z.number().positive().max(1_000_000_000),
  dayOfMonth: z.number().int().min(1).max(31).default(1),
  notes: z.string().max(1000).optional(),
});

const PostMonthBody = z.object({
  op: z.literal("post-month"),
  period: z.string().regex(/^\d{4}-\d{2}$/), // 'YYYY-MM'
});

const Body = z.discriminatedUnion("op", [CreateBody, PostMonthBody]);

export async function GET() {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["finances.view", "expense.manage"], session.permissions);
    const rows = await withTenant(session.tenantId, (tx) =>
      tx.select().from(recurringExpenses).where(eq(recurringExpenses.tenantId, session.tenantId)).orderBy(desc(recurringExpenses.createdAt))
    );
    return NextResponse.json({ templates: rows });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["finances.view", "expense.manage"], session.permissions);
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
    }

    if (parsed.data.op === "create") {
      const d = parsed.data;
      const row = await withTenant(session.tenantId, async (tx) => {
        const [created] = await tx
          .insert(recurringExpenses)
          .values({
            tenantId: session.tenantId,
            description: d.description,
            category: d.category,
            paidFrom: d.paidFrom,
            amount: String(d.amount),
            dayOfMonth: d.dayOfMonth,
            notes: d.notes ?? null,
            createdBy: session.userId,
          } as any)
          .returning();
        return created;
      });
      return NextResponse.json({ template: row });
    }

    // op === "post-month": generate ledger rows from active templates.
    const { period } = parsed.data;
    const [yStr, mStr] = period.split("-");
    const y = Number(yStr), m = Number(mStr);
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();

    const result = await withTenant(session.tenantId, async (tx) => {
      const templates = await tx
        .select()
        .from(recurringExpenses)
        .where(eq(recurringExpenses.tenantId, session.tenantId));
      const active = templates.filter((t) => t.active);
      let posted = 0;
      for (const t of active) {
        const day = Math.min(t.dayOfMonth || 1, lastDay);
        const expenseDate = `${period}-${String(day).padStart(2, "0")}`;
        // ON CONFLICT DO NOTHING against the partial unique index makes this safe to re-run.
        const res: any = await tx.execute(sql`
          INSERT INTO business_expenses
            (tenant_id, expense_date, description, category, paid_from, amount, notes, recurring_id, recurring_period, created_by)
          VALUES
            (${session.tenantId}, ${expenseDate}::date, ${t.description}, ${t.category}, ${t.paidFrom},
             ${t.amount}, ${t.notes ?? null}, ${t.id}, ${period}, ${session.userId})
          ON CONFLICT DO NOTHING
        `);
        posted += res.rowCount ?? 0;
      }
      return { posted, candidates: active.length };
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    return handleApiError(err);
  }
}
