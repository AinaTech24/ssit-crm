import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/reconciliation/exceptions/bulk
 *   Apply one action to many breaks at once.
 *     action = "status"  value = open|investigating|resolved|ignored
 *            = "sync"    → post opening-balance txns for every additive break
 *                          (feed > CRM) and resolve it; non-additive are skipped.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { reconciliationExceptions, transactions } from "@/db/schema";

export const dynamic = "force-dynamic";

const TOLERANCE = 0.5;

const Body = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  action: z.enum(["status", "sync"]),
  value: z.enum(["open", "investigating", "resolved", "ignored"]).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "transactions.execute", session.permissions);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const { ids, action, value } = parse.data;
    const meta = clientMetaFromHeaders(req.headers);

    const out = await withTenant(
      session.tenantId,
      async (tx) => {
        const scope = and(
          eq(reconciliationExceptions.tenantId, session.tenantId),
          inArray(reconciliationExceptions.id, ids)
        );

        if (action === "status") {
          if (!value) throw Object.assign(new Error("value required"), { status: 400 });
          const patch: any = { status: value, updatedAt: new Date() };
          if (value === "resolved") {
            patch.resolvedAt = new Date();
            patch.resolvedBy = session.userId;
          } else {
            patch.resolvedAt = null;
            patch.resolvedBy = null;
          }
          const updated = await tx.update(reconciliationExceptions).set(patch).where(scope).returning({ id: reconciliationExceptions.id });
          await recordAudit(tx, {
            tenantId: session.tenantId,
            actorUserId: session.userId,
            action: "reconciliation.exception.bulk_status",
            entityType: "reconciliation_exception",
            entityId: session.tenantId,
            after: { value, count: updated.length } as any,
            ...meta,
          });
          return { updated: updated.length, skipped: 0 };
        }

        // action === "sync": post an additive opening-balance txn per break.
        const exs = await tx.select().from(reconciliationExceptions).where(scope);
        const today = new Date().toISOString().slice(0, 10);
        let synced = 0;
        let skipped = 0;
        for (const ex of exs) {
          const crmUnits = Number(ex.crmUnits ?? 0);
          const feedUnits = Number(ex.feedUnits ?? 0);
          const addUnits = Math.round((feedUnits - crmUnits) * 10000) / 10000;
          if (!ex.investorId || addUnits <= TOLERANCE) {
            skipped++;
            continue;
          }
          const feedValue = ex.feedValue != null ? Number(ex.feedValue) : null;
          const nav = feedUnits > 0 && feedValue != null ? feedValue / feedUnits : null;
          const amount = nav != null ? Math.round(addUnits * nav * 100) / 100 : null;
          await tx
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
            .onConflictDoNothing({ target: [transactions.tenantId, transactions.dedupKey] });
          await tx
            .update(reconciliationExceptions)
            .set({
              status: "resolved",
              resolvedAt: new Date(),
              resolvedBy: session.userId,
              notes: `${ex.notes ? ex.notes + " " : ""}[synced to CRM: +${addUnits} units]`,
              updatedAt: new Date(),
            } as any)
            .where(eq(reconciliationExceptions.id, ex.id));
          synced++;
        }
        await recordAudit(tx, {
          tenantId: session.tenantId,
          actorUserId: session.userId,
          action: "reconciliation.exception.bulk_sync",
          entityType: "reconciliation_exception",
          entityId: session.tenantId,
          after: { synced, skipped } as any,
          ...meta,
        });
        return { updated: synced, skipped };
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    return NextResponse.json({ ok: true, ...out });
  } catch (err: any) {
    return handleApiError(err);
  }
}
