/**
 * Report scheduler — ticks hourly, finds saved reports whose email schedule is
 * due this hour (daily / weekly-on-day / monthly-on-date), renders + emails
 * each to its recipients, and stamps last_sent_at so it fires at most once per
 * occurrence. Cross-tenant scan via withSystem (same pattern as the other
 * schedulers); the per-report render is tenant-scoped inside deliverReport.
 */
import { sql } from "drizzle-orm";
import { withSystem } from "@/db/client";
import { savedReports } from "@/db/schema";
import { deliverReport } from "@/lib/reports/deliver";

export async function runReportScheduler(): Promise<{ due: number; delivered: number }> {
  const now = new Date();
  const hour = now.getHours();
  const dow = now.getDay(); // 0=Sun … 6=Sat
  const dom = now.getDate(); // 1..31

  const due = await withSystem(async (tx) =>
    tx
      .select()
      .from(savedReports)
      .where(sql`
        schedule IS NOT NULL
        AND (schedule->>'enabled')::boolean = true
        AND (schedule->>'hour')::int = ${hour}
        AND jsonb_array_length(COALESCE(schedule->'emails', '[]'::jsonb)) > 0
        AND (last_sent_at IS NULL OR last_sent_at < date_trunc('day', now()))
        AND (
          schedule->>'freq' = 'daily'
          OR (schedule->>'freq' = 'weekly'  AND (schedule->>'day')::int = ${dow})
          OR (schedule->>'freq' = 'monthly' AND (schedule->>'day')::int = ${dom})
        )
      `)
  );

  let delivered = 0;
  for (const report of due) {
    try {
      const r = await deliverReport(report as any);
      delivered += r.sent;
      if (r.errors.length) console.error("[report-scheduler]", report.id, "partial:", r.errors);
    } catch (e: any) {
      console.error("[report-scheduler] deliver failed", report.id, e?.message ?? e);
    }
    // Stamp regardless — a broken recipient shouldn't make us retry hourly.
    await withSystem(async (tx) => tx.execute(sql`UPDATE saved_reports SET last_sent_at = now() WHERE id = ${report.id}::uuid`));
  }
  return { due: due.length, delivered };
}

export function startReportSchedulerWorker(): () => void {
  const tick = async () => {
    try {
      const r = await runReportScheduler();
      if (r.due) console.log(`[report-scheduler] ${r.delivered} delivered / ${r.due} due`);
    } catch (e: any) {
      console.error("[report-scheduler] tick failed", e?.message ?? e);
    }
  };
  const interval = setInterval(tick, 60 * 60 * 1000); // hourly
  interval.unref?.();
  if (process.env.REPORT_SCHEDULER_ON_BOOT === "1") void tick();
  console.log("[report-scheduler] armed — hourly");
  return () => clearInterval(interval);
}
