import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/commission/payouts
 *
 * Manually enter / paste AMC brokerage-payout lines (the data the reconciler
 * matches against). This is the bridge that lets an MFD reconcile TODAY,
 * without waiting for the automated CAMS/KFin feed wiring — type or paste the
 * payout statement, then hit "Recompute reconciliation".
 *
 * Body: { period: 'YYYY-MM', rows: PayoutRow[] }
 * Owner / compliance / back-office (reports.commission capability).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { amcPayouts } from "@/db/schema";

export const dynamic = "force-dynamic";

const Row = z.object({
  amcCode: z.string().min(1).max(40),
  schemeCode: z.string().max(40).optional(),
  schemeName: z.string().max(200).optional(),
  payoutType: z.enum(["upfront", "trail", "transaction", "incentive", "other"]).default("trail"),
  grossAmount: z.number().finite(),
  tdsAmount: z.number().finite().default(0),
  netAmount: z.number().finite().optional(),
});

const Body = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/, "period must be YYYY-MM"),
  rows: z.array(Row).min(1).max(2000),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "reports.commission", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);

    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const { period, rows } = parse.data;
    const clientMeta = clientMetaFromHeaders(req.headers);

    const inserted = await withTenant(session.tenantId, async (tx) => {
      const values = rows.map((r) => {
        const net = r.netAmount ?? r.grossAmount - r.tdsAmount;
        return {
          tenantId: session.tenantId,
          period,
          amcCode: r.amcCode,
          schemeCode: r.schemeCode ?? null,
          schemeName: r.schemeName ?? null,
          payoutType: r.payoutType,
          grossAmount: r.grossAmount.toFixed(2),
          tdsAmount: r.tdsAmount.toFixed(2),
          netAmount: net.toFixed(2),
          sourceFeed: "manual" as const,
        };
      });
      await tx.insert(amcPayouts).values(values as any);

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "transaction.payout_import",
        entityType: "commission_period",
        entityId: null,
        meta: { period, count: values.length, source: "manual" },
        ...clientMeta,
      });
      return values.length;
    });

    return NextResponse.json({ ok: true, inserted, period });
  } catch (err: any) {
    return handleApiError(err);
  }
}
