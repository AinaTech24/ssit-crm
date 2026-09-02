import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/sips/[id]/defend
 *
 * "Save-the-SIP" recovery action for a predicted at-risk SIP. Creates a
 * high-priority follow-up task for the SIP's RM (falls back to the acting
 * user) so the intervention is tracked and accountable. The at-risk queue
 * lives at /dashboard/sips/at-risk.
 *
 * Body (optional): { reasons?: string[], note?: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny, can } from "@/lib/auth/rbac";
import { sips, tasks, investors } from "@/db/schema";
import { formatINR } from "@/lib/utils";

export const dynamic = "force-dynamic";

const Body = z.object({
  reasons: z.array(z.string()).optional(),
  note: z.string().max(500).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    // Creating an accountable follow-up task is an ops/sales action — gate it
    // (audit #40: tenant-scoped but RBAC-ungated mutation).
    requireAny(
      session.roles,
      ["transactions.view", "task.edit.all", "task.edit.assigned"],
      session.permissions
    );
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    const reasons = parsed.success ? parsed.data.reasons ?? [] : [];
    const note = parsed.success ? parsed.data.note : undefined;

    const result = await withTenant(
      session.tenantId,
      async (tx) => {
        const sip = (
          await tx.select().from(sips).where(and(eq(sips.id, id), eq(sips.tenantId, session.tenantId))).limit(1)
        )[0];
        if (!sip) return { notFound: true as const };

        const investor = sip.investorId
          ? (await tx.select({ name: investors.name, rmId: investors.rmId }).from(investors).where(eq(investors.id, sip.investorId)).limit(1))[0]
          : null;

        // RMs may only defend SIPs in their own book.
        const seesAll = can(session.roles, "investor.view.all", session.permissions) || can(session.roles, "reports.business", session.permissions);
        if (!seesAll && sip.rmId !== session.userId && investor?.rmId !== session.userId) {
          return { forbidden: true as const };
        }

        // Idempotency: a double-click (or two RMs on the queue) must not spawn
        // duplicate Save-SIP tasks. If an OPEN defend task already exists for
        // this SIP (tagged in meta), no-op and return it.
        const existing = (
          await tx.execute(sql`
            SELECT id FROM tasks
             WHERE tenant_id = ${session.tenantId}::uuid
               AND status NOT IN ('completed', 'cancelled')
               AND meta->>'sipId' = ${id}
             LIMIT 1
          `)
        ).rows[0] as { id: string } | undefined;
        if (existing) return { taskId: existing.id, deduped: true as const };

        const reasonText = reasons.length ? ` (${reasons.join(", ")})` : "";
        const dueAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000); // +2 days

        const inserted = await tx
          .insert(tasks)
          .values({
            tenantId: session.tenantId,
            subjectType: "investor",
            subjectId: sip.investorId,
            relatedInvestorId: sip.investorId,
            department: "sales",
            type: "follow_up",
            title: `Save SIP — ${sip.schemeName ?? "scheme"}${reasonText}`,
            description:
              `${investor?.name ?? "Client"}'s ${formatINR(Number(sip.amount))} ${sip.frequency} SIP is at risk` +
              `${reasonText}. Call the client, fix the mandate/bank issue, and reprocess before the next installment.` +
              (note ? `\n\nNote: ${note}` : ""),
            priority: "high",
            status: "open",
            assigneeId: (sip.rmId as string | null) ?? session.userId,
            createdById: session.userId,
            dueAt,
            meta: { sipId: id } as any,
          } as any)
          .returning({ id: tasks.id });

        return { taskId: inserted[0]?.id ?? null };
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    if ("notFound" in result) return NextResponse.json({ error: "SIP not found" }, { status: 404 });
    if ("forbidden" in result) return NextResponse.json({ error: "this SIP isn't in your book" }, { status: 403 });
    return NextResponse.json({ ok: true, taskId: result.taskId });
  } catch (err: any) {
    return handleApiError(err);
  }
}
