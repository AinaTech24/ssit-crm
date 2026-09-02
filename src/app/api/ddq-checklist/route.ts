import { handleApiError } from "@/lib/api/error-handler";
/**
 * PUT /api/ddq-checklist — upsert the status/note/document for one AMFI checklist item.
 *   Body: { itemKey, status, note?, documentId? }
 * Gated by compliance.edit. Tenant-scoped, idempotent on (tenant, itemKey).
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { ddqChecklistStatus, DDQ_CHECKLIST_STATUSES } from "@/db/schema";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { DDQ_ITEMS } from "@/lib/compliance/amfi-ddq-checklist";

export const dynamic = "force-dynamic";

const VALID_KEYS = new Set(DDQ_ITEMS.map((i) => i.key));

const Body = z.object({
  itemKey: z.string().min(1).max(64),
  status: z.enum(DDQ_CHECKLIST_STATUSES),
  note: z.string().max(2000).nullable().optional(),
  documentId: z.string().uuid().nullable().optional(),
});

export async function PUT(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "compliance.edit", session.permissions);
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const d = parsed.data;
    if (!VALID_KEYS.has(d.itemKey)) {
      return NextResponse.json({ error: "unknown checklist item" }, { status: 400 });
    }
    const meta = clientMetaFromHeaders(req.headers);

    const row = await withTenant(session.tenantId, async (tx) => {
      // Snapshot the prior state for the audit before/after (and to pick the
      // right action label). The write itself is an atomic upsert keyed by the
      // (tenant_id, item_key) unique index, so a concurrent insert / double
      // click resolves to an UPDATE instead of throwing a unique violation.
      const [existing] = await tx
        .select()
        .from(ddqChecklistStatus)
        .where(and(eq(ddqChecklistStatus.tenantId, session.tenantId), eq(ddqChecklistStatus.itemKey, d.itemKey)))
        .limit(1);

      const [next] = await tx
        .insert(ddqChecklistStatus)
        .values({
          tenantId: session.tenantId,
          itemKey: d.itemKey,
          status: d.status,
          note: d.note ?? null,
          documentId: d.documentId ?? null,
          updatedBy: session.userId,
        } as any)
        .onConflictDoUpdate({
          target: [ddqChecklistStatus.tenantId, ddqChecklistStatus.itemKey],
          set: {
            status: d.status,
            note: d.note ?? null,
            documentId: d.documentId ?? null,
            updatedBy: session.userId,
            updatedAt: new Date(),
          } as any,
        })
        .returning();

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: existing ? "ddq_checklist.update" : "ddq_checklist.create",
        entityType: "ddq_checklist",
        entityId: next.id,
        before: (existing ?? null) as any,
        after: next as any,
        ...meta,
      });
      return next;
    });

    return NextResponse.json({ item: row });
  } catch (err: any) {
    return handleApiError(err);
  }
}
