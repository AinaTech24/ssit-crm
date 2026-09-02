import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/health/workers
 *   Readiness probe for the BACKGROUND WORKER. The plain /api/health checks the
 *   web process + DB — it can be green while all automation is dead (separate
 *   process). This reports each scheduled job's last run + heartbeat and flags
 *   any that are overdue, so an uptime monitor can actually alert on a stalled
 *   worker.
 *
 *   Access: ?token=<HEALTH_TOKEN> when that env is set, else a platform-admin
 *   session.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withSystem } from "@/db/client";
import { getSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

// Expected cadence (hours) per job — used to compute "overdue".
const MAX_AGE_HOURS: Record<string, number> = {
  "daily-ops-scanner": 26,
  "nav-refresh": 26,
  "reconciliation-scanner": 26,
  "statement-scheduler": 26,
};

export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get("token");
    const expected = process.env.HEALTH_TOKEN;
    if (expected) {
      if (token !== expected) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    } else {
      const session = await getSession();
      if (!session || !session.roles?.includes("platform_admin")) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
    }

    const rows = await withSystem(async (tx) =>
      (
        await tx.execute(
          sql`SELECT job_name, last_run_at, last_run_status, last_heartbeat_at,
                     EXTRACT(EPOCH FROM (now() - last_run_at)) / 3600.0 AS age_hours
              FROM scheduler_state ORDER BY job_name`
        )
      ).rows as Array<{
        job_name: string;
        last_run_at: string | null;
        last_run_status: string | null;
        last_heartbeat_at: string | null;
        age_hours: number | null;
      }>
    );

    const jobs = rows.map((r) => {
      const maxAge = MAX_AGE_HOURS[r.job_name];
      const overdue = maxAge != null && (r.age_hours == null || Number(r.age_hours) > maxAge);
      return {
        job: r.job_name,
        lastRunAt: r.last_run_at,
        status: r.last_run_status,
        ageHours: r.age_hours != null ? Math.round(Number(r.age_hours) * 10) / 10 : null,
        overdue,
      };
    });

    // Any tracked fixed-time job missing entirely is itself a problem.
    const missing = Object.keys(MAX_AGE_HOURS).filter((j) => !rows.some((r) => r.job_name === j));
    const healthy = jobs.every((j) => !j.overdue) && missing.length === 0;

    return NextResponse.json({ healthy, jobs, missing }, { status: healthy ? 200 : 503 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
