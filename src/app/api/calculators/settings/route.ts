import { handleApiError } from "@/lib/api/error-handler";
/**
 * Calculator assumptions — read + manager upsert.
 *
 *   GET   /api/calculators/settings  — current assumptions (any authenticated user)
 *   PUT   /api/calculators/settings  — upsert the single per-tenant row.
 *                                      Managers only (owner / branch_head).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { calculatorSettings } from "@/db/schema";
import { loadCalcAssumptions } from "@/lib/calculators/assumptions";

export const dynamic = "force-dynamic";

const Body = z.object({
  returnPct: z.number().finite().min(0).max(30),
  inflationPct: z.number().finite().min(0).max(25),
  educationInflationPct: z.number().finite().min(0).max(25),
  debtReturnPct: z.number().finite().min(0).max(30),
});

export async function GET() {
  try {
    const session = await requireSession();
    const data = await withTenant(session.tenantId, async (tx) => {
      return loadCalcAssumptions(tx, session.tenantId);
    });
    return NextResponse.json({ settings: data });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await requireSession();
    const isManager = session.roles.some((r) => ["owner", "branch_head"].includes(r));
    if (!isManager) {
      return NextResponse.json({ error: "only a manager can change calculator settings" }, { status: 403 });
    }

    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }

    const v = parse.data;
    const stringified = {
      defaultReturnPct: String(v.returnPct),
      defaultInflationPct: String(v.inflationPct),
      educationInflationPct: String(v.educationInflationPct),
      debtReturnPct: String(v.debtReturnPct),
    };
    const clientMeta = clientMetaFromHeaders(req.headers);

    await withTenant(session.tenantId, async (tx) => {
      await tx
        .insert(calculatorSettings)
        .values({ tenantId: session.tenantId, ...stringified })
        .onConflictDoUpdate({
          target: calculatorSettings.tenantId,
          set: { ...stringified, updatedAt: new Date() },
        });
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "calculator.settings.update",
        entityType: "calculator_settings",
        entityId: session.tenantId,
        after: v as any,
        ...clientMeta,
      });
    });

    return NextResponse.json({ ok: true, settings: v });
  } catch (err: any) {
    return handleApiError(err);
  }
}
