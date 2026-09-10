import { handleApiError } from "@/lib/api/error-handler";
/**
 * PATCH / DELETE one activity entry.
 *
 * You may edit your own entry, or one you assigned. A manager (task.edit.all)
 * may edit any — the same bar the tracker's list view uses.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { activityEntries, TRACKER_STATUSES } from "@/db/schema";

export const dynamic = "force-dynamic";

const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected yyyy-mm-dd");

const ItemSchema = z.object({
  type: z.string().min(1).max(40),
  label: z.string().max(80).nullish(),
  qty: z.number().int().min(1).max(9999).default(1),
});

const Patch = z.object({
  title: z.string().min(1).max(200).optional(),
  itemType: z.string().max(40).nullish(),
  items: z.array(ItemSchema).max(20).nullish(),
  eventName: z.string().max(200).nullish(),
  topic: z.string().max(200).nullish(),
  createdFor: z.string().max(200).nullish(),
  notes: z.string().max(4000).nullish(),
  assignedByUserId: z.string().uuid().nullish(),
  assignedDate: DateStr.nullish(),
  completedDate: DateStr.nullish(),
  status: z.enum(TRACKER_STATUSES).optional(),
});

/** Own entry, one you assigned, or firm-wide edit rights. */
function mayTouch(
  row: { ownerUserId: string | null; assignedByUserId: string | null },
  userId: string,
  editAll: boolean
): boolean {
  return editAll || row.ownerUserId === userId || row.assignedByUserId === userId;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = Patch.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const b = parse.data;
    const editAll = can(session.roles, "task.edit.all", session.permissions);
    const clientMeta = clientMetaFromHeaders(req.headers);

    const outcome = await withTenant(session.tenantId, async (tx) => {
      const [before] = await tx
        .select()
        .from(activityEntries)
        .where(and(eq(activityEntries.id, id), eq(activityEntries.tenantId, session.tenantId)))
        .limit(1);
      if (!before) return "not_found" as const;
      if (!mayTouch(before, session.userId, editAll)) return "forbidden" as const;

      // Marking it complete without a date is the common case — fill today in
      // rather than leaving a completed row that cannot be reported on.
      const completing = b.status === "completed" && !before.completedDate && !b.completedDate;

      // Only the fields actually supplied, so an omitted key is left alone
      // rather than written as null.
      const patch: Partial<typeof activityEntries.$inferInsert> = { updatedAt: new Date() };
      if (b.title !== undefined) patch.title = b.title;
      if (b.itemType !== undefined) patch.itemType = b.itemType ?? null;
      if (b.items !== undefined) {
        patch.items = b.items?.length
          ? b.items.map((i) => ({ type: i.type, label: i.label ?? undefined, qty: i.qty }))
          : null;
        // Keep the legacy mirror in step with the real list.
        if (b.items?.length) patch.itemType = b.items[0].type;
      }
      if (b.eventName !== undefined) patch.eventName = b.eventName ?? null;
      if (b.topic !== undefined) patch.topic = b.topic ?? null;
      if (b.createdFor !== undefined) patch.createdFor = b.createdFor ?? null;
      if (b.notes !== undefined) patch.notes = b.notes ?? null;
      if (b.assignedByUserId !== undefined) patch.assignedByUserId = b.assignedByUserId ?? null;
      if (b.assignedDate !== undefined) patch.assignedDate = b.assignedDate ?? null;
      if (b.completedDate !== undefined) patch.completedDate = b.completedDate ?? null;
      if (b.status !== undefined) patch.status = b.status;
      if (completing) patch.completedDate = new Date().toISOString().slice(0, 10);

      const [after] = await tx
        .update(activityEntries)
        .set(patch)
        .where(and(eq(activityEntries.id, id), eq(activityEntries.tenantId, session.tenantId)))
        .returning();

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "activity.update",
        entityType: "activity_entry",
        entityId: id,
        after: { status: after.status, title: after.title },
        ...clientMeta,
      });
      return { row: after } as const;
    });

    if (outcome === "not_found") return NextResponse.json({ error: "not found" }, { status: 404 });
    if (outcome === "forbidden") {
      return NextResponse.json({ error: "you can only edit your own entries" }, { status: 403 });
    }
    return NextResponse.json(outcome.row);
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    const editAll = can(session.roles, "task.edit.all", session.permissions);
    const clientMeta = clientMetaFromHeaders(req.headers);

    const outcome = await withTenant(session.tenantId, async (tx) => {
      const [before] = await tx
        .select()
        .from(activityEntries)
        .where(and(eq(activityEntries.id, id), eq(activityEntries.tenantId, session.tenantId)))
        .limit(1);
      if (!before) return "not_found" as const;
      if (!mayTouch(before, session.userId, editAll)) return "forbidden" as const;

      // Attachments cascade at the DB level (0208).
      await tx
        .delete(activityEntries)
        .where(and(eq(activityEntries.id, id), eq(activityEntries.tenantId, session.tenantId)));
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "activity.delete",
        entityType: "activity_entry",
        entityId: id,
        before: { title: before.title },
        ...clientMeta,
      });
      return "ok" as const;
    });

    if (outcome === "not_found") return NextResponse.json({ error: "not found" }, { status: 404 });
    if (outcome === "forbidden") {
      return NextResponse.json({ error: "you can only delete your own entries" }, { status: 403 });
    }
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
