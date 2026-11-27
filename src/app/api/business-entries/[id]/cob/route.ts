import { handleApiError } from "@/lib/api/error-handler";
/**
 * PATCH /api/business-entries/[id]/cob   { done: boolean, reason?: string }
 *
 * The answer to the change-of-broker check: Yes, it is done - or No, with the reason. May be given by the client's
 * RM, the person who executed the transaction, the RM who booked it, or an owner / back-office user.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { businessEntries, investors } from "@/db/schema";

export const dynamic = "force-dynamic";

const Body = z
  .object({ done: z.boolean(), reason: z.string().trim().max(1000).optional() })
  .refine((b) => b.done || !!b.reason, { message: "Give the reason it is not done." });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["investor.view.all", "investor.view.assigned"], session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid body" }, { status: 400 });

    const outcome = await withTenant(session.tenantId, async (tx) => {
      const [entry] = await tx
        .select()
        .from(businessEntries)
        .where(and(eq(businessEntries.id, id), eq(businessEntries.tenantId, session.tenantId), isNull(businessEntries.deletedAt)))
        .limit(1);
      if (!entry) return "not_found" as const;
      if (!entry.cobStatus) return "no_cob" as const;
      const [client] = entry.investorId
        ? await tx.select({ rmId: investors.rmId }).from(investors).where(eq(investors.id, entry.investorId)).limit(1)
        : [];
      const involved = [client?.rmId, entry.executedById, entry.rmId].includes(session.userId);
      const manager = session.roles.some((r) => ["owner", "back_office", "ops", "branch_head"].includes(r));
      if (!involved && !manager) return "forbidden" as const;

      await tx
        .update(businessEntries)
        .set({
          cobStatus: parsed.data.done ? "done" : "not_done",
          cobReason: parsed.data.done ? null : parsed.data.reason!,
          cobAnsweredBy: session.userId,
          cobAnsweredAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(businessEntries.id, id));
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "business_entry.cob_answered",
        entityType: "business_entry",
        entityId: id,
        after: { done: parsed.data.done, reason: parsed.data.reason ?? null },
        ...clientMetaFromHeaders(req.headers),
      });
      return "ok" as const;
    });

    if (outcome === "not_found") return NextResponse.json({ error: "not found" }, { status: 404 });
    if (outcome === "no_cob") return NextResponse.json({ error: "this entry has no change of broker to confirm" }, { status: 400 });
    if (outcome === "forbidden") return NextResponse.json({ error: "only the client's RM or the person who executed it can answer this" }, { status: 403 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
