/**
 * POST /api/webhooks/attendance-device — punching machine → CRM attendance.
 *
 * The machine (or its vendor software / a small bridge script) pushes raw
 * punches; we fold them into the same per-day attendance row the clock widget
 * uses. Brand-neutral on purpose: any device that can POST JSON works.
 *
 *   Header:  x-device-key: <ATTENDANCE_DEVICE_KEY>
 *   Body:    { "punches": [ { "employeeCode": "E017", "timestamp": "2026-10-14T09:42:10+05:30" } ] }
 *            (a single object without the wrapper is accepted too)
 *
 * The employee is matched on users.employee_code. The earliest punch of the day
 * is the clock-in, the latest (if different) the clock-out. Replays are
 * harmless: LEAST/GREATEST make the result the same however often a punch
 * arrives. A timestamp with no offset is read as IST.
 *
 * Env: ATTENDANCE_DEVICE_KEY (shared secret) and ATTENDANCE_DEVICE_TENANT_ID
 * (the firm the machine belongs to). Unset → the endpoint refuses everything.
 */

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";

export const dynamic = "force-dynamic";

const Punch = z.object({
  employeeCode: z.string().min(1).max(64),
  timestamp: z.string().min(8).max(40),
});
const Body = z.union([z.object({ punches: z.array(Punch).max(1000) }), Punch.transform((p) => ({ punches: [p] }))]);

function keyOk(given: string | null, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function parseTs(s: string): Date | null {
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(s.trim());
  const d = new Date(hasZone ? s : `${s.trim().replace(" ", "T")}+05:30`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function POST(req: NextRequest) {
  const key = process.env.ATTENDANCE_DEVICE_KEY;
  const tenantId = process.env.ATTENDANCE_DEVICE_TENANT_ID;
  if (!key || !tenantId) return NextResponse.json({ error: "not configured" }, { status: 503 });
  if (!keyOk(req.headers.get("x-device-key"), key)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parse = Body.safeParse(await req.json().catch(() => null));
  if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  let applied = 0;
  const unknown = new Set<string>();
  const badTime: string[] = [];

  await withTenant(tenantId, async (tx) => {
    for (const p of parse.data.punches) {
      const ts = parseTs(p.timestamp);
      if (!ts) {
        badTime.push(p.employeeCode);
        continue;
      }
      const r = await tx.execute(sql`
        INSERT INTO attendance (tenant_id, employee_user_id, attendance_date, status, clock_in_at, source)
        SELECT u.tenant_id, u.id, (${ts.toISOString()}::timestamptz AT TIME ZONE 'Asia/Kolkata')::date,
               'present', ${ts.toISOString()}::timestamptz, 'device'
          FROM users u
         WHERE u.tenant_id = ${tenantId}::uuid AND u.employee_code = ${p.employeeCode}
         LIMIT 1
        ON CONFLICT (tenant_id, employee_user_id, attendance_date) DO UPDATE SET
          clock_in_at  = LEAST(COALESCE(attendance.clock_in_at, EXCLUDED.clock_in_at), EXCLUDED.clock_in_at),
          clock_out_at = CASE
            WHEN EXCLUDED.clock_in_at > COALESCE(attendance.clock_in_at, EXCLUDED.clock_in_at)
              THEN GREATEST(COALESCE(attendance.clock_out_at, EXCLUDED.clock_in_at), EXCLUDED.clock_in_at)
            ELSE attendance.clock_out_at END,
          status = 'present',
          updated_at = now()
        RETURNING id
      `);
      if (r.rows.length === 0) {
        unknown.add(p.employeeCode);
        continue;
      }
      applied++;
    }
    // Work out worked minutes once per touched row, after all punches landed.
    await tx.execute(sql`
      UPDATE attendance SET
        total_minutes = GREATEST(0, ROUND(EXTRACT(EPOCH FROM (clock_out_at - clock_in_at)) / 60))::int
      WHERE tenant_id = ${tenantId}::uuid AND source = 'device'
        AND clock_in_at IS NOT NULL AND clock_out_at IS NOT NULL
        AND updated_at >= now() - interval '1 minute'
    `);
  });

  return NextResponse.json({ ok: true, applied, unknownEmployeeCodes: [...unknown], badTimestamps: badTime });
}
