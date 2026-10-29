import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/attendance/clock  — self clock-in / clock-out.
 *
 * Body: { action: "in" | "out", employeeUserId? }
 *   in  → opens today's row (status=present) and starts a new session — again
 *         after each clock-out. Clocking in while already in is a no-op.
 *   out → closes the running session; total_minutes sums every closed session.
 *
 * Defaults to the current user; a manager may punch for another employee.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { isClockedIn, punchesOf, summarise } from "@/lib/attendance/punches";

export const dynamic = "force-dynamic";

const Body = z.object({
  action: z.enum(["in", "out"]),
  employeeUserId: z.string().uuid().optional(),
  /** Optional geolocation captured by the browser at punch time. */
  lat: z.number().optional(),
  lng: z.number().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const { action } = parse.data;
    const employeeUserId = parse.data.employeeUserId ?? session.userId;
    const isManager = can(session.roles, "attendance.manage.all", session.permissions);
    if (employeeUserId !== session.userId && !isManager) {
      return NextResponse.json({ error: "only a manager can punch for another employee" }, { status: 403 });
    }
    const lat = parse.data.lat ?? null;
    const lng = parse.data.lng ?? null;
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null;

    const result = await withTenant(session.tenantId, async (tx) => {
      // The day can hold several sessions (back from lunch, another visit…), so
      // punching in again after clocking out opens a NEW session rather than
      // being ignored. The row's in/out/total columns summarise all of them.
      const cur = await tx.execute(sql`
        SELECT punches, clock_in_at, clock_out_at FROM attendance
         WHERE tenant_id = ${session.tenantId}::uuid AND employee_user_id = ${employeeUserId}::uuid
           AND attendance_date = current_date
         FOR UPDATE
      `);
      const punches = punchesOf(cur.rows[0]);
      const now = new Date().toISOString();
      if (action === "in") {
        if (!isClockedIn(punches)) punches.push({ in: now, out: null });
      } else {
        if (!isClockedIn(punches)) return { error: "clock in first" };
        punches[punches.length - 1].out = now;
      }
      const s = summarise(punches);
      const r = await tx.execute(sql`
        INSERT INTO attendance (tenant_id, employee_user_id, attendance_date, status, punches, clock_in_at, clock_out_at, total_minutes,
                                clock_in_lat, clock_in_lng, clock_in_ip, clock_out_lat, clock_out_lng, clock_out_ip, source)
        VALUES (${session.tenantId}::uuid, ${employeeUserId}::uuid, current_date, 'present', ${JSON.stringify(punches)}::jsonb,
                ${s.clockInAt}::timestamptz, ${s.clockOutAt}::timestamptz, ${s.totalMinutes},
                ${action === "in" ? lat : null}, ${action === "in" ? lng : null}, ${action === "in" ? ip : null},
                ${action === "out" ? lat : null}, ${action === "out" ? lng : null}, ${action === "out" ? ip : null}, 'clock')
        ON CONFLICT (tenant_id, employee_user_id, attendance_date) DO UPDATE SET
          punches = EXCLUDED.punches,
          clock_in_at = EXCLUDED.clock_in_at,
          clock_out_at = EXCLUDED.clock_out_at,
          total_minutes = EXCLUDED.total_minutes,
          clock_in_lat = COALESCE(attendance.clock_in_lat, EXCLUDED.clock_in_lat),
          clock_in_lng = COALESCE(attendance.clock_in_lng, EXCLUDED.clock_in_lng),
          clock_in_ip = COALESCE(attendance.clock_in_ip, EXCLUDED.clock_in_ip),
          clock_out_lat = COALESCE(EXCLUDED.clock_out_lat, attendance.clock_out_lat),
          clock_out_lng = COALESCE(EXCLUDED.clock_out_lng, attendance.clock_out_lng),
          clock_out_ip = COALESCE(EXCLUDED.clock_out_ip, attendance.clock_out_ip),
          status = 'present',
          source = 'clock',
          updated_at = now()
        RETURNING clock_in_at, status, total_minutes, clock_out_at, punches
      `);
      return { row: r.rows[0] };
    });

    if ((result as any).error) return NextResponse.json({ error: (result as any).error }, { status: 400 });
    return NextResponse.json({ ok: true, ...(result as any).row });
  } catch (err: any) {
    return handleApiError(err);
  }
}
