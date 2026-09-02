import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { ddqChecklistStatus } from "@/db/schema";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { handleApiError } from "@/lib/api/error-handler";
import { DDQ_ITEMS } from "@/lib/compliance/amfi-ddq-checklist";
import { AUTO_VERIFIERS } from "@/lib/compliance/ddq-autoverifiers";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "compliance.edit", session.permissions);
    const meta = clientMetaFromHeaders(req.headers);

    const updatedItems = await withTenant(session.tenantId, async (tx) => {
      const itemsToVerify = DDQ_ITEMS.filter((item) => item.coverage === "in_app");
      const results: any[] = [];

      for (const item of itemsToVerify) {
        const verifier = AUTO_VERIFIERS[item.key];
        if (!verifier) continue;

        const checkResult = await verifier(tx, session.tenantId);
        if (checkResult.verified) {
          const [existing] = await tx
            .select()
            .from(ddqChecklistStatus)
            .where(and(eq(ddqChecklistStatus.tenantId, session.tenantId), eq(ddqChecklistStatus.itemKey, item.key)))
            .limit(1);

          const autoNote = `[Auto-Verified] ${checkResult.reason || ""}`;

          // Atomic upsert on (tenant_id, item_key) — safe against a concurrent
          // manual PUT or a double-fired autoverify (no unique-violation 500).
          const [next] = await tx
            .insert(ddqChecklistStatus)
            .values({
              tenantId: session.tenantId,
              itemKey: item.key,
              status: "in_place",
              note: autoNote,
              updatedBy: session.userId,
            } as any)
            .onConflictDoUpdate({
              target: [ddqChecklistStatus.tenantId, ddqChecklistStatus.itemKey],
              set: {
                status: "in_place",
                note: autoNote,
                updatedBy: session.userId,
                updatedAt: new Date(),
              } as any,
            })
            .returning();

          await recordAudit(tx, {
            tenantId: session.tenantId,
            actorUserId: session.userId,
            action: existing ? "ddq_checklist.autoverify" : "ddq_checklist.autoverify_create",
            entityType: "ddq_checklist",
            entityId: next.id,
            before: (existing ?? null) as any,
            after: next as any,
            ...meta,
          });
          results.push(next);
        }
      }

      // Query refreshed list
      const refreshedList = await tx
        .select()
        .from(ddqChecklistStatus)
        .where(eq(ddqChecklistStatus.tenantId, session.tenantId));

      return refreshedList;
    });

    return NextResponse.json({ success: true, items: updatedItems });
  } catch (err: any) {
    return handleApiError(err);
  }
}
