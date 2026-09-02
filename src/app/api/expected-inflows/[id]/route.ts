import { handleApiError } from "@/lib/api/error-handler";
/**
 * PATCH  /api/expected-inflows/[id] — edit; re-syncs the reminder task
 * DELETE /api/expected-inflows/[id] — remove; cancels its reminder task
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { expectedInflows, tasks } from "@/db/schema";
import { InflowPatchBody } from "@/lib/inflows/schema";
import { syncInflowReminder } from "@/lib/inflows/reminder";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireSession();
    requireAny(session.roles, ["investor.edit.all", "investor.edit.assigned"], session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = InflowPatchBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }

    const patch: any = { updatedAt: new Date() };
    for (const k of ["ownerId", "sourceType", "expectedOn", "confidence", "status", "investedAt", "remindDaysBefore", "notes"] as const) {
      if (parse.data[k] !== undefined) patch[k] = parse.data[k];
    }
    for (const k of ["expectedAmount", "investedAmount"] as const) {
      if (parse.data[k] !== undefined) patch[k] = parse.data[k] == null ? null : String(parse.data[k]);
    }
    // Recording an investment implies the money landed — stamp the date.
    if (patch.status === "invested" && !patch.investedAt) patch.investedAt = new Date().toISOString().slice(0, 10);

    const out = await withTenant(
      session.tenantId,
      async (tx) => {
        const [before] = await tx
          .select()
          .from(expectedInflows)
          .where(and(eq(expectedInflows.id, id), eq(expectedInflows.tenantId, session.tenantId)))
          .limit(1);
        if (!before) return { notFound: true as const };

        await tx.update(expectedInflows).set(patch).where(eq(expectedInflows.id, id));
        const merged = { ...before, ...patch };

        const taskId = await syncInflowReminder(tx, session.tenantId, session.userId, {
          id,
          investorId: merged.investorId,
          ownerId: merged.ownerId,
          sourceType: merged.sourceType,
          expectedAmount: merged.expectedAmount,
          expectedOn: String(merged.expectedOn),
          remindDaysBefore: merged.remindDaysBefore,
          reminderTaskId: merged.reminderTaskId ?? null,
          status: merged.status,
        });
        if (taskId && taskId !== before.reminderTaskId) {
          await tx.update(expectedInflows).set({ reminderTaskId: taskId }).where(eq(expectedInflows.id, id));
        }
        return { ok: true as const };
      },
      { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles }
    );

    if ("notFound" in out) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireSession();
    requireAny(session.roles, ["investor.edit.all", "investor.edit.assigned"], session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);

    await withTenant(
      session.tenantId,
      async (tx) => {
        const [row] = await tx
          .select({ reminderTaskId: expectedInflows.reminderTaskId })
          .from(expectedInflows)
          .where(and(eq(expectedInflows.id, id), eq(expectedInflows.tenantId, session.tenantId)))
          .limit(1);
        if (row?.reminderTaskId) {
          await tx
            .update(tasks)
            .set({ status: "cancelled", updatedAt: new Date() })
            .where(and(eq(tasks.id, row.reminderTaskId), eq(tasks.tenantId, session.tenantId)));
        }
        await tx
          .delete(expectedInflows)
          .where(and(eq(expectedInflows.id, id), eq(expectedInflows.tenantId, session.tenantId)));
      },
      { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles }
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
