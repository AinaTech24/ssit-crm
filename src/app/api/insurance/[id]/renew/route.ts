import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/insurance/[id]/renew — record a premium payment + advance the policy.
 *
 * A renewal is a domain action, not a generic field edit, so it lives here
 * (the old "Mark renewed" button computed the next due date in the browser and
 * stored it verbatim via the policy PATCH). This endpoint:
 *   - recomputes next_premium_due_date SERVER-SIDE from the policy's frequency
 *     (advance by one period from the later of the current due date or today, so
 *      a long-overdue policy still lands in the future),
 *   - stamps last_premium_date = today and status = 'active',
 *   - CLEARS lapse_alerted_at so a future re-lapse alerts again (the scanner only
 *     fires when that marker is null — without this, a renewed-then-re-lapsed
 *     policy would never re-alert),
 *   - emits insurance.renewed + audits.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, can } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { insurancePolicies, investors, eventsOutbox } from "@/db/schema";

export const dynamic = "force-dynamic";

/** Months to advance per premium frequency. `single` has no renewal. */
const FREQ_MONTHS: Record<string, number> = { annual: 12, semi_annual: 6, quarterly: 3, monthly: 1 };

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "insurance.write", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const seesAll = can(session.roles, "investor.view.all", session.permissions) || can(session.roles, "compliance.view", session.permissions);
    const clientMeta = clientMetaFromHeaders(req.headers);

    const outcome = await withTenant(session.tenantId, async (tx) => {
      const p = (
        await tx.select().from(insurancePolicies).where(and(eq(insurancePolicies.id, id), eq(insurancePolicies.tenantId, session.tenantId))).limit(1)
      )[0];
      if (!p) return { error: "not_found" as const };

      // Non-managers may only renew their own book (a client they manage OR a
      // policy they sold) — mirrors the read scoping.
      if (!seesAll) {
        const inv = (await tx.select({ rmId: investors.rmId }).from(investors).where(eq(investors.id, p.investorId)).limit(1))[0];
        if (p.soldByUserId !== session.userId && inv?.rmId !== session.userId) return { error: "forbidden" as const };
      }

      const months = FREQ_MONTHS[p.premiumFrequency ?? "annual"];
      if (!months) return { error: "single_pay" as const };

      // Server-authoritative + TZ-correct: advance from the later of the current
      // due date or today, by one frequency period. GREATEST ignores a NULL due.
      const [updated] = (
        await tx.execute(sql`
          UPDATE insurance_policies
             SET next_premium_due_date = (GREATEST(next_premium_due_date, current_date) + (${months}::text || ' months')::interval)::date,
                 last_premium_date = current_date,
                 status = 'active',
                 lapse_alerted_at = NULL,
                 updated_at = now()
           WHERE id = ${id}::uuid AND tenant_id = ${session.tenantId}::uuid
          RETURNING next_premium_due_date, last_premium_date
        `)
      ).rows as Array<{ next_premium_due_date: string; last_premium_date: string }>;

      await tx.insert(eventsOutbox).values({
        tenantId: session.tenantId,
        kind: "insurance.renewed",
        entityType: "investor",
        entityId: p.investorId,
        after: {
          policyId: id,
          planName: p.planName,
          insurer: p.insurer,
          policyNumber: p.policyNumber,
          nextPremiumDueDate: updated?.next_premium_due_date ?? null,
          paidOn: updated?.last_premium_date ?? null,
          wasLapsed: p.status === "lapsed",
        } as any,
        meta: { userId: session.userId } as any,
      } as any);

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "insurance.renew",
        entityType: "insurance_policy",
        entityId: id,
        before: { status: p.status, nextPremiumDueDate: p.nextPremiumDueDate } as any,
        after: { status: "active", nextPremiumDueDate: updated?.next_premium_due_date ?? null } as any,
        ...clientMeta,
      });

      return { ok: true as const, nextPremiumDueDate: updated?.next_premium_due_date ?? null };
    });

    if ("error" in outcome) {
      if (outcome.error === "forbidden") return NextResponse.json({ error: "this policy isn't in your book" }, { status: 403 });
      if (outcome.error === "single_pay") return NextResponse.json({ error: "single-pay policies have no renewal" }, { status: 400 });
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json(outcome);
  } catch (err: any) {
    return handleApiError(err);
  }
}
