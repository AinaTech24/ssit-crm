import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/reconciliation/exceptions/[id]/sync
 *
 * One-click FIX for a holdings break: post an opening-balance transaction so the
 * CRM ledger matches the RTA/CAS feed, then resolve the break. This is the
 * additive direction only (feed units > CRM units) — i.e. "Missing in CRM" and
 * unit mismatches where the feed shows MORE. Removing CRM units (feed stale) is
 * deliberately NOT auto-applied: that's an investigate-manually case.
 *
 * Idempotent: the posted transaction's dedup_key is keyed to the exception id,
 * so re-syncing never double-posts.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { reconciliationExceptions, transactions } from "@/db/schema";

export const dynamic = "force-dynamic";

const TOLERANCE = 0.5;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "transactions.execute", session.permissions);

    const result = await withTenant(
      session.tenantId,
      async (tx) => {
        const [ex] = await tx
          .select()
          .from(reconciliationExceptions)
          .where(and(eq(reconciliationExceptions.id, id), eq(reconciliationExceptions.tenantId, session.tenantId)))
          .limit(1);
        if (!ex) return { kind: "not_found" as const };
        if (!ex.investorId) return { kind: "no_investor" as const };

        const crmUnits = Number(ex.crmUnits ?? 0);
        const feedUnits = Number(ex.feedUnits ?? 0);
        const addUnits = Math.round((feedUnits - crmUnits) * 10000) / 10000;
        if (addUnits <= TOLERANCE) {
          // CRM already has >= feed units — syncing would have to REMOVE units,
          // which we never do automatically.
          return { kind: "not_additive" as const };
        }

        const feedValue = ex.feedValue != null ? Number(ex.feedValue) : null;
        const nav = feedUnits > 0 && feedValue != null ? feedValue / feedUnits : null;
        const amount = nav != null ? Math.round(addUnits * nav * 100) / 100 : null;
        const today = new Date().toISOString().slice(0, 10);

        const inserted = await tx
          .insert(transactions)
          .values({
            tenantId: session.tenantId,
            investorId: ex.investorId,
            folioNumber: ex.folioNumber ?? null,
            schemeCode: ex.schemeCode ?? null,
            schemeName: ex.schemeName ?? null,
            type: "purchase",
            direction: "inflow",
            status: "processed",
            units: String(addUnits) as any,
            nav: nav != null ? (String(Math.round(nav * 10000) / 10000) as any) : null,
            amount: amount != null ? (String(amount) as any) : null,
            orderDate: today as any,
            sourceFeed: "other",
            remarks: "Reconciliation sync — opening balance from RTA/CAS feed",
            executedByUserId: session.userId,
            dedupKey: `recon-sync:${ex.id}`,
          } as any)
          .onConflictDoNothing({ target: [transactions.tenantId, transactions.dedupKey] })
          .returning({ id: transactions.id });

        const txnId = inserted[0]?.id ?? null;

        await tx
          .update(reconciliationExceptions)
          .set({
            status: "resolved",
            resolvedAt: new Date(),
            resolvedBy: session.userId,
            notes: `${ex.notes ? ex.notes + " " : ""}[synced to CRM: +${addUnits} units${txnId ? `, txn ${txnId}` : " (already posted)"}]`,
            updatedAt: new Date(),
          } as any)
          .where(and(eq(reconciliationExceptions.id, id), eq(reconciliationExceptions.tenantId, session.tenantId)));

        await recordAudit(tx, {
          tenantId: session.tenantId,
          actorUserId: session.userId,
          action: "reconciliation.exception.sync",
          entityType: "reconciliation_exception",
          entityId: id,
          after: { addUnits, amount, txnId } as any,
          ...clientMetaFromHeaders(req.headers),
        });
        return { kind: "ok" as const, addUnits, txnId };
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    if (result.kind === "not_found") return NextResponse.json({ error: "not found" }, { status: 404 });
    if (result.kind === "no_investor")
      return NextResponse.json({ error: "break has no linked client" }, { status: 400 });
    if (result.kind === "not_additive")
      return NextResponse.json(
        { error: "CRM already holds ≥ the feed units — investigate manually (sync only adds units)." },
        { status: 400 }
      );
    return NextResponse.json({ ok: true, addUnits: result.addUnits, txnId: result.txnId });
  } catch (err: any) {
    return handleApiError(err);
  }
}
