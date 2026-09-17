import { handleApiError } from "@/lib/api/error-handler";
/**
 * PATCH  /api/business-expenses/recurring/:id  — toggle active / edit a template
 * DELETE /api/business-expenses/recurring/:id  — delete a template (posted ledger
 *                                                rows are kept)
 *
 * Gated by `reports.commission`. Tenant-scoped via RLS.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, requireAny } from "@/lib/auth/rbac";
import { recurringExpenses, EXPENSE_CATEGORIES, PAID_FROM } from "@/db/schema";

export const dynamic = "force-dynamic";

const PatchBody = z.object({
  active: z.boolean().optional(),
  description: z.string().min(1).max(300).optional(),
  category: z.enum(EXPENSE_CATEGORIES).optional(),
  paidFrom: z.enum(PAID_FROM).optional(),
  amount: z.number().positive().max(1_000_000_000).optional(),
  dayOfMonth: z.number().int().min(1).max(31).optional(),
  notes: z.string().max(1000).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["finances.view", "expense.manage"], session.permissions);
    const { id } = await params;
    const parsed = PatchBody.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const d = parsed.data;
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (d.active !== undefined) patch.active = d.active;
    if (d.description !== undefined) patch.description = d.description;
    if (d.category !== undefined) patch.category = d.category;
    if (d.paidFrom !== undefined) patch.paidFrom = d.paidFrom;
    if (d.amount !== undefined) patch.amount = String(d.amount);
    if (d.dayOfMonth !== undefined) patch.dayOfMonth = d.dayOfMonth;
    if (d.notes !== undefined) patch.notes = d.notes;

    const row = await withTenant(session.tenantId, async (tx) => {
      const [updated] = await tx
        .update(recurringExpenses)
        .set(patch as any)
        .where(and(eq(recurringExpenses.id, id), eq(recurringExpenses.tenantId, session.tenantId)))
        .returning();
      return updated;
    });
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ template: row });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["finances.view", "expense.manage"], session.permissions);
    const { id } = await params;
    await withTenant(session.tenantId, (tx) =>
      tx.delete(recurringExpenses).where(and(eq(recurringExpenses.id, id), eq(recurringExpenses.tenantId, session.tenantId)))
    );
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
