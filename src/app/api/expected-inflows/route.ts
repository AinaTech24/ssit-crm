import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET  /api/expected-inflows        — list (optionally ?investorId=)
 * POST /api/expected-inflows        — create + spawn its reminder task
 */

import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { expectedInflows, investors, users } from "@/db/schema";
import { InflowBody } from "@/lib/inflows/schema";
import { syncInflowReminder } from "@/lib/inflows/reminder";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["investor.view.all", "investor.view.assigned"], session.permissions);
    const investorId = req.nextUrl.searchParams.get("investorId");

    const rows = await withTenant(
      session.tenantId,
      async (tx) =>
        tx
          .select({
            id: expectedInflows.id,
            investorId: expectedInflows.investorId,
            investorName: investors.name,
            ownerId: expectedInflows.ownerId,
            ownerName: users.name,
            sourceType: expectedInflows.sourceType,
            expectedAmount: expectedInflows.expectedAmount,
            expectedOn: expectedInflows.expectedOn,
            confidence: expectedInflows.confidence,
            status: expectedInflows.status,
            investedAmount: expectedInflows.investedAmount,
            investedAt: expectedInflows.investedAt,
            remindDaysBefore: expectedInflows.remindDaysBefore,
            reminderTaskId: expectedInflows.reminderTaskId,
            notes: expectedInflows.notes,
          })
          .from(expectedInflows)
          .leftJoin(investors, eq(investors.id, expectedInflows.investorId))
          .leftJoin(users, eq(users.id, expectedInflows.ownerId))
          .where(
            investorId
              ? and(eq(expectedInflows.tenantId, session.tenantId), eq(expectedInflows.investorId, investorId))
              : eq(expectedInflows.tenantId, session.tenantId)
          )
          .orderBy(asc(expectedInflows.expectedOn))
          .limit(1000),
      { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles }
    );
    return NextResponse.json({ inflows: rows });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["investor.edit.all", "investor.edit.assigned"], session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = InflowBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const d = parse.data;

    const out = await withTenant(
      session.tenantId,
      async (tx) => {
        // The client must belong to this tenant (RLS scopes, but be explicit).
        const [client] = await tx
          .select({ id: investors.id, rmId: investors.rmId })
          .from(investors)
          .where(and(eq(investors.id, d.investorId), eq(investors.tenantId, session.tenantId)))
          .limit(1);
        if (!client) return { notFound: true as const };

        const [row] = await tx
          .insert(expectedInflows)
          .values({
            tenantId: session.tenantId,
            investorId: d.investorId,
            ownerId: d.ownerId ?? client.rmId ?? session.userId,
            sourceType: d.sourceType,
            expectedAmount: d.expectedAmount != null ? String(d.expectedAmount) : null,
            expectedOn: d.expectedOn,
            confidence: d.confidence ?? "medium",
            status: d.status ?? "expected",
            remindDaysBefore: d.remindDaysBefore ?? 14,
            notes: d.notes ?? null,
            createdBy: session.userId,
          } as any)
          .returning();

        const taskId = await syncInflowReminder(tx, session.tenantId, session.userId, {
          id: row.id,
          investorId: row.investorId,
          ownerId: row.ownerId,
          sourceType: row.sourceType as any,
          expectedAmount: row.expectedAmount,
          expectedOn: row.expectedOn as any,
          remindDaysBefore: row.remindDaysBefore,
          reminderTaskId: null,
          status: row.status,
        });
        if (taskId) {
          await tx.update(expectedInflows).set({ reminderTaskId: taskId }).where(eq(expectedInflows.id, row.id));
        }
        return { id: row.id, reminderTaskId: taskId };
      },
      { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles }
    );

    if ("notFound" in out) return NextResponse.json({ error: "client not found" }, { status: 404 });
    return NextResponse.json(out, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
