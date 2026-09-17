/**
 * GET /api/investors/[id]/full — the complete client-360 payload for the mobile
 * detail screen. It replicates the web /dashboard/investors/[id] RSC data fetch
 * exactly (same queries + the same lib helpers: valueInvestor, churnForInvestor,
 * assetClassExposure, assessSuitability, clientCompleteness, crossSell) so the
 * mobile detail shows identical numbers. Read-only; logs a DPDP PII-access row.
 */

import { handleApiError } from "@/lib/api/error-handler";
import { NextResponse } from "next/server";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { assertInScope } from "@/lib/auth/data-scope";
import { valueInvestor } from "@/lib/finance/valuation";
import { churnForInvestor } from "@/lib/churn/scan";
import { assetClassExposure } from "@/lib/investors/asset-class";
import { assessSuitability } from "@/lib/investors/suitability";
import { clientCompleteness } from "@/lib/investors/completeness";
import { crossSellOpportunities } from "@/lib/investors/cross-sell";
import {
  investors, folios, sips, goals, transactions, communications, tasks,
  serviceRequests, consents, auditLog, users, families, reviewMeetings, riskProfileResponses,
} from "@/db/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!id || !UUID_RE.test(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
    const session = await requireSession();
    if (!can(session.roles, "investor.view.all", session.permissions) && !can(session.roles, "investor.view.assigned", session.permissions)) {
      return NextResponse.json({ error: "forbidden: missing view capability" }, { status: 403 });
    }

    const data = await withTenant(
      session.tenantId,
      async (tx) => {
        const inv = (await tx.select().from(investors).where(eq(investors.id, id)).limit(1))[0];
        if (!inv || (inv as any).deletedAt) return null;

        // Same wall as the web 360 view. Capability above only says "some
        // clients"; this route otherwise served ANY client in the tenant to
        // anyone holding investor.view.assigned — the mobile app's client-360
        // endpoint had no per-row check at all.
        await assertInScope(tx, session, { branchId: inv.branchId, ownerId: [inv.rmId, inv.serviceRmId] }, "client");

        const [foliosRows, sipsRows, goalsRows, commsRows, tasksRows, srRows, consentsRows, rmRow, familyRow, lumpsumSum, valuation, reviewMeetingsRows, riskHistoryRows, recentTxRows, txCountRow, sipBouncesRow] = await Promise.all([
          tx.select().from(folios).where(eq(folios.investorId, id)),
          tx.select().from(sips).where(eq(sips.investorId, id)),
          tx.select().from(goals).where(eq(goals.investorId, id)),
          tx.select().from(communications).where(eq(communications.investorId, id)).orderBy(desc(communications.createdAt)).limit(20),
          tx.select().from(tasks).where(and(eq(tasks.subjectId, id), eq(tasks.subjectType, "investor"), isNull(tasks.deletedAt))).limit(20),
          tx.select().from(serviceRequests).where(eq(serviceRequests.investorId, id)).limit(20),
          tx.select().from(consents).where(eq(consents.investorId, id)),
          inv.rmId
            ? tx.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.id, inv.rmId)).limit(1).then((r) => r[0] ?? null)
            : Promise.resolve(null),
          inv.familyId
            ? tx.select().from(families).where(eq(families.id, inv.familyId)).limit(1).then((r) => r[0] ?? null)
            : Promise.resolve(null),
          tx.execute(sql`
            SELECT COALESCE(SUM(amount::numeric), 0)::numeric AS total FROM transactions
            WHERE investor_id = ${id} AND type = 'lumpsum' AND status IN ('processed', 'successful')
          `).then((r) => Number((r.rows[0] as any)?.total ?? 0)),
          valueInvestor(tx as any, id),
          tx.select().from(reviewMeetings).where(eq(reviewMeetings.investorId, id)),
          tx.select().from(riskProfileResponses).where(eq(riskProfileResponses.investorId, id)).orderBy(desc(riskProfileResponses.signedAt)),
          tx.select().from(transactions).where(eq(transactions.investorId, id)).orderBy(sql`${transactions.orderDate} desc nulls last`, desc(transactions.createdAt)).limit(30),
          tx.execute(sql`SELECT count(*)::int AS c FROM transactions WHERE investor_id = ${id}`).then((r) => Number((r.rows[0] as any)?.c ?? 0)),
          tx.execute(sql`
            SELECT count(*)::int AS c FROM transactions
            WHERE investor_id = ${id} AND type = 'sip' AND status IN ('rejected','failed') AND created_at >= now() - interval '180 days'
          `).then((r) => Number((r.rows[0] as any)?.c ?? 0)),
        ]);

        const activeSips = sipsRows.filter((s) => s.status === "active").length;
        const maxConsecutiveFailures = sipsRows.reduce((m, s) => Math.max(m, parseInt((s.consecutiveFailures as any) ?? "0", 10) || 0), 0);
        const monthlyCommitted = sipsRows.filter((s) => s.status === "active").reduce((sum, s) => sum + Number(s.amount ?? 0), 0);
        const sipHealth = { activeSips, bounces6mo: sipBouncesRow, maxConsecutiveFailures, monthlyCommitted };

        const insuranceCount = Number(((await tx.execute(sql`SELECT count(*)::int AS c FROM insurance_policies WHERE investor_id = ${id}`)).rows[0] as any)?.c ?? 0);
        const referralCount = Number(((await tx.execute(sql`SELECT count(*)::int AS c FROM leads WHERE referred_by_investor_id = ${id}`)).rows[0] as any)?.c ?? 0);

        // DPDP PII access log — parity with the web 360 view.
        await tx.insert(auditLog).values({
          tenantId: session.tenantId,
          actorUserId: session.userId,
          actorType: "user",
          action: "investor.view",
          entityType: "investor",
          entityId: id,
          piiAccessed: { pan: true, dob: !!inv.dob, address: !!inv.address } as any,
          reason: "Investor 360 view (mobile)",
        } as any);

        const churn = await churnForInvestor(tx as any, id, valuation.xirr);
        const exposure = assetClassExposure(foliosRows as any);
        const completeness = clientCompleteness(inv as any);
        const suitability = assessSuitability((inv as any).riskProfile ?? null, exposure.equityPct, exposure.classifiedPct);
        const crossSell = crossSellOpportunities((inv as any).crossSell);

        return {
          investor: inv,
          folios: foliosRows,
          sips: sipsRows,
          goals: goalsRows,
          communications: commsRows,
          tasks: tasksRows,
          serviceRequests: srRows,
          consents: consentsRows,
          rm: rmRow,
          family: familyRow,
          totalLumpsum: lumpsumSum,
          valuation,
          churn,
          reviewMeetings: reviewMeetingsRows,
          riskHistory: riskHistoryRows,
          insuranceCount,
          referralCount,
          recentTransactions: recentTxRows,
          txCount: txCountRow,
          sipHealth,
          exposure,
          suitability,
          completeness,
          crossSell,
        };
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(data);
  } catch (err) {
    return handleApiError(err);
  }
}
