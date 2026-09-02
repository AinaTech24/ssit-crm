import { handleApiError } from "@/lib/api/error-handler";
/**
 * Leave policy settings — read + manager upsert.
 *
 *   GET   /api/leave-applications/settings  — current entitlements (any authenticated user)
 *   PUT   /api/leave-applications/settings  — upsert the single per-tenant row.
 *                                             Managers only (owner / branch_head).
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { leaveSettings } from "@/db/schema";
import { loadLeaveEntitlements } from "@/lib/leave/settings";

export const dynamic = "force-dynamic";

const LEAVE_TYPES = ["casual", "sick", "earned", "unpaid", "comp_off", "other"] as const;

// Each entitlement is a number 0–365 or null (uncapped).
const Entitlement = z.union([z.number().int().min(0).max(365), z.null()]);

const Body = z.object({
  entitlements: z.record(z.enum(LEAVE_TYPES), Entitlement),
  carryForwardEarned: z.boolean(),
});

export async function GET() {
  try {
    const session = await requireSession();
    const data = await withTenant(session.tenantId, async (tx) => {
      const entitlements = await loadLeaveEntitlements(tx, session.tenantId);
      const row = (
        await tx
          .select({ carryForwardEarned: leaveSettings.carryForwardEarned })
          .from(leaveSettings)
          .where(eq(leaveSettings.tenantId, session.tenantId))
          .limit(1)
      )[0];
      return { entitlements, carryForwardEarned: row?.carryForwardEarned ?? false };
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
      return NextResponse.json({ error: "only a manager can change leave settings" }, { status: 403 });
    }

    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }

    const vals = {
      entitlements: parse.data.entitlements as Record<string, number | null>,
      carryForwardEarned: parse.data.carryForwardEarned,
    };
    const clientMeta = clientMetaFromHeaders(req.headers);

    await withTenant(session.tenantId, async (tx) => {
      await tx
        .insert(leaveSettings)
        .values({ tenantId: session.tenantId, ...vals })
        .onConflictDoUpdate({
          target: leaveSettings.tenantId,
          set: { ...vals, updatedAt: new Date() },
        });
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "leave.settings.update",
        entityType: "leave_settings",
        entityId: session.tenantId,
        after: vals as any,
        ...clientMeta,
      });
    });

    return NextResponse.json({ ok: true, settings: vals });
  } catch (err: any) {
    return handleApiError(err);
  }
}
