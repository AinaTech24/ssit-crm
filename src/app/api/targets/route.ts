import { handleApiError } from "@/lib/api/error-handler";
/**
 * PUT /api/targets — set a team member's sales + meeting targets.
 *
 * Owners / branch heads can set targets for any member of their firm; everyone
 * else may set only their own. Targets live on the `users` row (annual_target,
 * sip_monthly_target, new_meetings_monthly_target, renewal_meetings_monthly_target).
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { users } from "@/db/schema";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";

export const dynamic = "force-dynamic";

const isManager = (roles: string[]) => roles.some((r) => ["owner", "branch_head"].includes(r));

const Body = z.object({
  userId: z.string().uuid(),
  annualTarget: z.number().min(0).max(1e13).nullable().optional(),
  sipMonthlyTarget: z.number().min(0).max(1e11).nullable().optional(),
  newMeetingsMonthlyTarget: z.number().int().min(0).max(1000).nullable().optional(),
  renewalMeetingsMonthlyTarget: z.number().int().min(0).max(1000).nullable().optional(),
});

export async function PUT(req: NextRequest) {
  try {
    const session = await requireSession();
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const b = parse.data;

    // Non-managers may only edit their own targets.
    if (!isManager(session.roles) && b.userId !== session.userId) {
      return NextResponse.json({ error: "You can only set your own targets." }, { status: 403 });
    }

    const meta = clientMetaFromHeaders(req.headers);
    const set: Record<string, unknown> = {};
    if (b.annualTarget !== undefined) set.annualTarget = b.annualTarget == null ? null : String(b.annualTarget);
    if (b.sipMonthlyTarget !== undefined) set.sipMonthlyTarget = b.sipMonthlyTarget == null ? null : String(b.sipMonthlyTarget);
    if (b.newMeetingsMonthlyTarget !== undefined) set.newMeetingsMonthlyTarget = b.newMeetingsMonthlyTarget;
    if (b.renewalMeetingsMonthlyTarget !== undefined) set.renewalMeetingsMonthlyTarget = b.renewalMeetingsMonthlyTarget;
    if (Object.keys(set).length === 0) {
      return NextResponse.json({ error: "nothing to update" }, { status: 400 });
    }

    const updated = await withTenant(session.tenantId, async (tx) => {
      // RLS + explicit tenant predicate guarantee the target user is in-firm.
      const r = await tx
        .update(users)
        .set(set as any)
        .where(and(eq(users.id, b.userId), eq(users.tenantId, session.tenantId)))
        .returning({ id: users.id });
      if (r.length === 0) throw Object.assign(new Error("member not found"), { status: 404 });

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "target.update",
        entityType: "user",
        entityId: b.userId,
        after: set as any,
        ...meta,
      });
      return r[0];
    });

    return NextResponse.json({ ok: true, id: updated.id });
  } catch (err: any) {
    return handleApiError(err);
  }
}
