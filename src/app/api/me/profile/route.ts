/**
 * PATCH /api/me/profile — update your own basic profile (name, phone).
 *
 * Self-service for every role. Deliberately limited to harmless fields — a
 * user can NOT change their own roles, email, targets, department, or reporting
 * manager here (those stay owner-controlled in the Employees admin).
 */

import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { users } from "@/db/schema";
import { handleApiError } from "@/lib/api/error-handler";
import { LEAVE_TYPE_LABELS, getEntitlement, currentFyStart } from "@/lib/leave/policy";
import { primaryRoleLabel } from "@/lib/auth/rbac";

export const dynamic = "force-dynamic";

const LEAVE_TYPES = ["casual", "sick", "earned", "comp_off"];

/** GET — the mobile profile bundle (identity, 2FA status, targets, leave, activity). */
export async function GET() {
  try {
    const session = await requireSession();
    const data = await withTenant(
      session.tenantId,
      async (tx) => {
        const [u] = await tx.select().from(users).where(eq(users.id, session.userId)).limit(1);
        const fyStart = currentFyStart();
        const leaveRows = (
          await tx.execute(sql`
            SELECT leave_type, COALESCE(SUM(no_of_days), 0)::float AS used
            FROM leave_applications
            WHERE tenant_id = ${session.tenantId}::uuid AND employee_user_id = ${session.userId}::uuid
              AND status = 'approved' AND from_date >= ${fyStart}
            GROUP BY leave_type
          `)
        ).rows as any[];
        const activity = (
          await tx.execute(sql`
            SELECT action, entity_type, at FROM audit_log
            WHERE tenant_id = ${session.tenantId}::uuid AND actor_user_id = ${session.userId}::uuid
            ORDER BY at DESC LIMIT 12
          `)
        ).rows as any[];
        return { u, leaveRows, activity };
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    const u: any = data.u ?? {};
    const custom = (u.customLeaveEntitlements ?? {}) as Record<string, number>;
    const usedByType: Record<string, number> = {};
    for (const r of data.leaveRows) usedByType[r.leave_type] = Number(r.used) || 0;
    const leave = LEAVE_TYPES.map((type) => {
      const entitlement = getEntitlement(type as any, custom);
      const used = usedByType[type] ?? 0;
      return {
        type,
        label: LEAVE_TYPE_LABELS[type] ?? type,
        entitlement,
        used,
        remaining: entitlement == null ? null : Math.max(0, entitlement - used),
      };
    });

    return NextResponse.json({
      user: {
        name: u.name ?? "",
        email: u.email ?? "",
        phone: u.phone ?? "",
        emailVerified: !!u.emailVerifiedAt,
        avatarUrl: u.avatarUrl ?? null,
        department: u.department ?? null,
        roleLabel: primaryRoleLabel(session.roles),
      },
      twoFaEnabled: !!u.twoFaEnabled,
      targets: { annual: u.annualTarget ?? null, sipMonthly: u.sipMonthlyTarget ?? null },
      leave,
      activity: data.activity.map((a) => ({ action: a.action, entityType: a.entity_type, at: a.at })),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

const Body = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  phone: z.string().trim().max(20).optional().or(z.literal("")),
  // Profile photo URL. Only a relative app path (/api/upload-local/…) or an
  // http(s) URL is accepted — never a javascript:/data: URL — so it's safe to
  // render in an <img src>.
  avatarUrl: z
    .string()
    .trim()
    .max(2000)
    .refine((v) => v === "" || v.startsWith("/") || /^https?:\/\//i.test(v), "invalid url")
    .optional()
    .or(z.literal("")),
});

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireSession();
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid input", issues: parsed.error.issues }, { status: 400 });
    }
    const patch: Record<string, any> = { updatedAt: new Date() };
    if (parsed.data.name !== undefined) patch.name = parsed.data.name;
    if (parsed.data.phone !== undefined) patch.phone = parsed.data.phone || null;
    if (parsed.data.avatarUrl !== undefined) patch.avatarUrl = parsed.data.avatarUrl || null;

    await withTenant(session.tenantId, async (tx) => {
      await tx.update(users).set(patch).where(eq(users.id, session.userId));
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
