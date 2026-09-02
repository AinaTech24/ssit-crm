/**
 * Scheduled auto-statements.
 *
 * Proactive transparency on autopilot: every client whose statement_cadence is
 * 'monthly' or 'quarterly' is auto-emailed their LIVE portfolio statement once
 * per period, with no RM effort. Renders the same PDF as the manual action via
 * the shared sendInvestorStatement() helper, so what the client receives on a
 * schedule is identical to an ad-hoc send.
 *
 * Due logic (watermark = investors.last_statement_sent_at):
 *   monthly   → due when last send is before the start of this month
 *   quarterly → due when last send is before the start of this calendar quarter
 * Sets the watermark after each send, so a same-day re-run is a no-op.
 *
 * Only clients with an email on file are auto-sent (statements go as a PDF
 * attachment). Each send writes a communications audit row.
 */

import { sql } from "drizzle-orm";
import { withSystem, withTenant } from "@/db/client";
import { sendInvestorStatement } from "@/lib/finance/send-statement";

export interface StatementSchedulerResult {
  tenants: number;
  due: number;
  sent: number;
  failed: number;
  durationMs: number;
}

export async function runStatementScheduler(): Promise<StatementSchedulerResult> {
  const startedAt = Date.now();
  const tenants = await withSystem(async (tx) => {
    const r = await tx.execute(sql`SELECT id FROM tenants WHERE status IN ('active','trial')`);
    return (r.rows as Array<{ id: string }>).map((row) => row.id);
  });

  let due = 0;
  let sent = 0;
  let failed = 0;

  for (const tenantId of tenants) {
    let dueIds: string[] = [];
    try {
      // 1) Read-only: which clients are due this period.
      dueIds = await withTenant(tenantId, async (tx) => {
        const rows = await tx.execute(sql`
          SELECT id FROM investors
          WHERE tenant_id = ${tenantId}::uuid
            AND status = 'active'
            AND statement_cadence IN ('monthly','quarterly')
            AND email IS NOT NULL AND email <> ''
            AND (
              last_statement_sent_at IS NULL
              OR (statement_cadence = 'monthly'   AND last_statement_sent_at < date_trunc('month', now()))
              OR (statement_cadence = 'quarterly' AND last_statement_sent_at < date_trunc('quarter', now()))
            )
          ORDER BY id
          LIMIT 5000
        `);
        return (rows.rows as Array<{ id: string }>).map((r) => r.id);
      });
    } catch (err: any) {
      console.error(`[statement-scheduler] tenant ${tenantId} list failed:`, err?.message ?? err);
      continue;
    }
    due += dueIds.length;

    // 2) Each client is its OWN transaction: send + watermark commit together,
    //    re-checking the due-condition under the row to avoid a double-send if
    //    two ticks race. A crash loses at most the one in-flight client, never
    //    re-sends a client whose watermark already committed.
    for (const id of dueIds) {
      try {
        const res = await withTenant(tenantId, async (tx) => {
          const guard = await tx.execute(sql`
            SELECT 1 FROM investors
            WHERE id = ${id}::uuid AND status = 'active'
              AND statement_cadence IN ('monthly','quarterly')
              AND (
                last_statement_sent_at IS NULL
                OR (statement_cadence = 'monthly'   AND last_statement_sent_at < date_trunc('month', now()))
                OR (statement_cadence = 'quarterly' AND last_statement_sent_at < date_trunc('quarter', now()))
              )
            FOR UPDATE
          `);
          if (guard.rows.length === 0) return { ok: false as const, skipped: true };
          const r = await sendInvestorStatement(tx, { tenantId, investorId: id, channel: "email", actorUserId: null });
          if (r.ok) {
            await tx.execute(sql`UPDATE investors SET last_statement_sent_at = now(), updated_at = now() WHERE id = ${id}::uuid`);
          }
          return { ok: r.ok, skipped: false };
        });
        if (res.ok) sent++;
        else if (!res.skipped) failed++;
      } catch (err: any) {
        failed++;
        console.error(`[statement-scheduler] tenant ${tenantId} investor ${id} failed:`, err?.message ?? err);
      }
    }
  }

  if (sent > 0 || failed > 0) {
    console.log(`[statement-scheduler] sent ${sent}/${due} statement(s), ${failed} failed across ${tenants.length} tenant(s)`);
  }
  return { tenants: tenants.length, due, sent, failed, durationMs: Date.now() - startedAt };
}
