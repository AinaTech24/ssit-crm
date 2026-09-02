import { handleApiError } from "@/lib/api/error-handler";
/**
 * Attendance work-hours settings — read + manager upsert.
 *
 *   GET   /api/attendance/settings  — current policy (any authenticated user)
 *   PUT   /api/attendance/settings  — upsert the single per-tenant row.
 *                                     Managers only (owner / branch_head).
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { attendanceSettings } from "@/db/schema";
import { loadAttendancePolicy } from "@/lib/attendance/settings";

export const dynamic = "force-dynamic";

const HHMM = /^\d{2}:\d{2}$/;
const DAY_MINUTES = 24 * 60;

const Body = z.object({
  workStart: z.string().regex(HHMM, "expected HH:MM"),
  workEnd: z.string().regex(HHMM, "expected HH:MM"),
  graceMinutes: z.number().int().min(0).max(DAY_MINUTES),
  halfDayMinutes: z.number().int().min(0).max(DAY_MINUTES),
  fullDayMinutes: z.number().int().min(0).max(DAY_MINUTES),
  weekOffDays: z.array(z.number().int().min(0).max(6)),
  requireGeo: z.boolean(),
});

export async function GET() {
  try {
    const session = await requireSession();
    const data = await withTenant(session.tenantId, async (tx) => {
      const policy = await loadAttendancePolicy(tx, session.tenantId);
      const row = (
        await tx
          .select({ requireGeo: attendanceSettings.requireGeo })
          .from(attendanceSettings)
          .where(eq(attendanceSettings.tenantId, session.tenantId))
          .limit(1)
      )[0];
      return { ...policy, requireGeo: row?.requireGeo ?? false };
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
      return NextResponse.json({ error: "only a manager can change attendance settings" }, { status: 403 });
    }

    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }

    // De-dupe + sort the week-off days for a stable stored value.
    const weekOffDays = Array.from(new Set(parse.data.weekOffDays)).sort((a, b) => a - b);
    const vals = { ...parse.data, weekOffDays };
    const clientMeta = clientMetaFromHeaders(req.headers);

    await withTenant(session.tenantId, async (tx) => {
      await tx
        .insert(attendanceSettings)
        .values({ tenantId: session.tenantId, ...vals })
        .onConflictDoUpdate({
          target: attendanceSettings.tenantId,
          set: { ...vals, updatedAt: new Date() },
        });
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "attendance.settings.update",
        entityType: "attendance_settings",
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
