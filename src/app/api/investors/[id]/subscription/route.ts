import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/investors/[id]/subscription  { action: "renew" }
 *
 * Takes a renewal: moves the renewal date one subscription period on (see
 * nextRenewal — from the date it was DUE, so paying late does not push every
 * later renewal out). The date is worked out here, never sent by the browser.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { investors } from "@/db/schema";
import { assertInScope } from "@/lib/auth/data-scope";
import { nextRenewal } from "@/lib/subscriptions";

export const dynamic = "force-dynamic";

const Body = z.object({ action: z.literal("renew") });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["investor.edit.all", "investor.edit.assigned"], session.permissions);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const meta = clientMetaFromHeaders(req.headers);

    const result = await withTenant(session.tenantId, async (tx) => {
      const [before] = await tx
        .select()
        .from(investors)
        .where(and(eq(investors.id, id), eq(investors.tenantId, session.tenantId)))
        .limit(1);
      if (!before) return null;
      await assertInScope(tx, session, { branchId: before.branchId, ownerId: [before.rmId, before.serviceRmId] }, "client");
      if (before.subscriptionCategory !== "subscribed" || !before.subscriptionFrequency) {
        return "not_subscribed" as const;
      }
      const renewalAt = nextRenewal(before.subscriptionRenewalAt, before.subscriptionFrequency);
      await tx
        .update(investors)
        .set({ subscriptionRenewalAt: renewalAt, updatedAt: new Date() })
        .where(and(eq(investors.id, id), eq(investors.tenantId, session.tenantId)));
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "investor.subscription_renewed",
        entityType: "investor",
        entityId: id,
        before: { renewalAt: before.subscriptionRenewalAt },
        after: { renewalAt },
        ...meta,
      });
      return { renewalAt };
    });
    if (result === null) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (result === "not_subscribed") {
      return NextResponse.json({ error: "This client is not on a subscription." }, { status: 400 });
    }
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
