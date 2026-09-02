import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/review-meetings/bulk — apply one action to many meetings at once.
 *
 * Body: { ids: string[], action, value? }
 *   action = "status"   value = scheduled|completed|rescheduled|cancelled|…
 *          = "assign"   value = userId (uuid) — reassigns the RM
 *          = "delete"   (no value) → cancel (status='cancelled'), matching the
 *                       single-record DELETE which cancels rather than purges.
 *
 * RBAC: review_meeting.manage.all updates any meeting in the tenant;
 * manage.assigned users may only bulk-edit meetings they own (rmId = them) —
 * enforced in the WHERE clause.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can, requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { reviewMeetings, users } from "@/db/schema";
import { REVIEW_MEETING_STATUSES } from "@/db/schema/review_meetings";

export const dynamic = "force-dynamic";

const Body = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  action: z.enum(["status", "assign", "delete"]),
  value: z.string().nullable().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["review_meeting.manage.all", "review_meeting.manage.assigned"], session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const { ids, action, value } = parsed.data;
    const canAll = can(session.roles, "review_meeting.manage.all", session.permissions);
    const meta = clientMetaFromHeaders(req.headers);

    const patch: Record<string, any> = { updatedAt: new Date() };
    if (action === "delete") {
      patch.status = "cancelled";
    } else if (action === "status") {
      if (!value || !(REVIEW_MEETING_STATUSES as readonly string[]).includes(value)) {
        return NextResponse.json({ error: "invalid status" }, { status: 400 });
      }
      patch.status = value;
    } else if (action === "assign") {
      if (!value) return NextResponse.json({ error: "value (userId) required" }, { status: 400 });
    }

    const count = await withTenant(session.tenantId, async (tx) => {
      if (action === "assign") {
        const [u] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, value!), eq(users.tenantId, session.tenantId)))
          .limit(1);
        if (!u) throw Object.assign(new Error("RM not found in this firm"), { status: 400 });
        patch.rmId = value;
      }

      const conds: any[] = [eq(reviewMeetings.tenantId, session.tenantId), inArray(reviewMeetings.id, ids)];
      // Assigned-only managers can only touch meetings they own.
      if (!canAll) conds.push(eq(reviewMeetings.rmId, session.userId));

      const upd = await tx
        .update(reviewMeetings)
        .set(patch)
        .where(and(...conds))
        .returning({ id: reviewMeetings.id });

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: `review_meeting.bulk_${action}`,
        entityType: "review_meeting",
        entityId: ids[0],
        after: { ids, action, value: value ?? null, count: upd.length } as any,
        ...meta,
      }).catch(() => {});

      return upd.length;
    });

    return NextResponse.json({ ok: true, count });
  } catch (err: any) {
    return handleApiError(err);
  }
}
