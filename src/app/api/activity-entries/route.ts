import { handleApiError } from "@/lib/api/error-handler";
/**
 * Activity tracker entries.
 *
 *   GET  /api/activity-entries?kind=marketing|research[&mine=1]
 *   POST /api/activity-entries
 *
 * Scope: a user sees their OWN entries plus anything they assigned. Managers
 * (task.view.all) see the whole firm's — that is the point of the tracker, an
 * RM needs to see what came back from the work they asked for.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, or, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can, requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { activityEntries, users, TRACKER_KINDS, TRACKER_STATUSES } from "@/db/schema";

export const dynamic = "force-dynamic";

const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected yyyy-mm-dd");

const Body = z.object({
  kind: z.enum(TRACKER_KINDS).default("marketing"),
  title: z.string().min(1).max(200),
  itemType: z.string().max(40).nullish(),
  eventName: z.string().max(200).nullish(),
  topic: z.string().max(200).nullish(),
  createdFor: z.string().max(200).nullish(),
  notes: z.string().max(4000).nullish(),
  assignedByUserId: z.string().uuid().nullish(),
  ownerUserId: z.string().uuid().nullish(),
  assignedDate: DateStr.nullish(),
  completedDate: DateStr.nullish(),
  status: z.enum(TRACKER_STATUSES).default("in_progress"),
  taskId: z.string().uuid().nullish(),
});

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const sp = req.nextUrl.searchParams;
    const kind = sp.get("kind");
    const mine = sp.get("mine") === "1";
    const seesAll = can(session.roles, "task.view.all", session.permissions);

    const rows = await withTenant(session.tenantId, async (tx) => {
      const conds = [eq(activityEntries.tenantId, session.tenantId)];
      if (kind) conds.push(eq(activityEntries.kind, kind));
      // Own work, or work you asked for. `mine=1` forces the narrow view even
      // for a manager, which is how they check their own queue.
      if (mine || !seesAll) {
        conds.push(
          or(
            eq(activityEntries.ownerUserId, session.userId),
            eq(activityEntries.assignedByUserId, session.userId)
          )!
        );
      }
      const owner = users;
      return tx
        .select({
          e: activityEntries,
          ownerName: owner.name,
          assignerName: sql<string | null>`(SELECT u2.name FROM users u2 WHERE u2.id = ${activityEntries.assignedByUserId})`,
          attachments: sql<number>`(SELECT count(*)::int FROM activity_attachments a
             WHERE a.activity_id = ${activityEntries.id} AND a.deleted_at IS NULL)`,
        })
        .from(activityEntries)
        .leftJoin(owner, eq(owner.id, activityEntries.ownerUserId))
        .where(and(...conds))
        .orderBy(desc(activityEntries.assignedDate), desc(activityEntries.createdAt))
        .limit(300);
    });

    return NextResponse.json({
      rows: rows.map((r) => ({
        ...r.e,
        ownerName: r.ownerName,
        assignerName: r.assignerName,
        attachments: Number(r.attachments ?? 0),
      })),
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    // Logging your own work rides on the task capabilities — the same ones that
    // let an RM assign the work in the first place.
    requireAny(session.roles, ["task.edit.all", "task.edit.assigned"], session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const b = parse.data;
    const clientMeta = clientMetaFromHeaders(req.headers);

    const row = await withTenant(session.tenantId, async (tx) => {
      const [created] = await tx
        .insert(activityEntries)
        .values({
          tenantId: session.tenantId,
          kind: b.kind,
          title: b.title,
          itemType: b.itemType ?? null,
          eventName: b.eventName ?? null,
          topic: b.topic ?? null,
          createdFor: b.createdFor ?? null,
          notes: b.notes ?? null,
          assignedByUserId: b.assignedByUserId ?? null,
          // Logging on someone else's behalf is allowed but rare; default to self.
          ownerUserId: b.ownerUserId ?? session.userId,
          assignedDate: b.assignedDate ?? null,
          completedDate: b.completedDate ?? null,
          status: b.status,
          taskId: b.taskId ?? null,
          createdById: session.userId,
        })
        .returning();
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "activity.create",
        entityType: "activity_entry",
        entityId: created.id,
        after: { kind: b.kind, title: b.title },
        ...clientMeta,
      });
      return created;
    });

    return NextResponse.json(row, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
