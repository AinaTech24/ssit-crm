/**
 * DDQ 4.26 — annual Declaration of Self-Certification reminder.
 *
 * The DSC is filed once per financial year, in AMFI's prescribed format, for the
 * firm's own ARN AND for every sub-distributor. It is the single most commonly
 * missed annual obligation because nothing prompts it — so this worker raises a
 * compliance task once the new FY opens (April) and keeps it open until a
 * dsc_declarations row for that FY moves past 'pending'.
 *
 * Idempotent: one task per tenant per FY, deduped on a remark marker (same
 * approach as the monthly compliance seeder).
 */

import { sql } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import { withSystem, withTenant } from "@/db/client";
import { tasks } from "@/db/schema";

/** India FY string for a date — "2026-27". */
function fyOf(d: Date): string {
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
}

export async function runDscReminder(now = new Date()): Promise<number> {
  const fy = fyOf(now);
  const marker = `[dsc-${fy}]`;
  let created = 0;

  const tenantIds = await withSystem(async (tx) => {
    const r = await tx.execute(sql`SELECT id FROM tenants WHERE status IN ('active','trial') AND deleted_at IS NULL`);
    return (r.rows as any[]).map((x) => x.id as string);
  });

  for (const tenantId of tenantIds) {
    try {
      await withTenant(tenantId, async (tx) => {
        // Already filed for this FY? Nothing to nag about.
        const filed = await tx.execute(sql`
          SELECT 1 FROM dsc_declarations
           WHERE tenant_id = ${tenantId}::uuid
             AND financial_year = ${fy}
             AND subject_type = 'self'
             AND status <> 'pending'
           LIMIT 1`);
        if (filed.rows.length) return;

        // Already reminded for this FY?
        const existing = await tx.execute(sql`
          SELECT 1 FROM tasks
           WHERE tenant_id = ${tenantId}::uuid
             AND COALESCE(remarks,'') LIKE ${`${marker}%`}
           LIMIT 1`);
        if (existing.rows.length) return;

        const owner = await tx.execute(sql`
          SELECT id FROM users
           WHERE tenant_id = ${tenantId}::uuid AND status = 'active'
             AND ('compliance' = ANY(roles) OR 'owner' = ANY(roles))
           ORDER BY ('compliance' = ANY(roles)) DESC, ('owner' = ANY(roles)) DESC
           LIMIT 1`);
        const assigneeId = (owner.rows[0] as any)?.id as string | undefined;
        if (!assigneeId) return;

        const subs = await tx.execute(sql`
          SELECT COUNT(*)::int AS c FROM sub_distributors WHERE tenant_id = ${tenantId}::uuid`);
        const subCount = Number((subs.rows[0] as any)?.c ?? 0);

        // Due 30 June — comfortably inside the AMFI submission window.
        const dueAt = new Date(now);
        dueAt.setMonth(5, 30);
        dueAt.setHours(18, 0, 0, 0);

        await tx.insert(tasks).values({
          id: uuid(),
          tenantId,
          subjectType: "internal",
          subjectId: null,
          assigneeId,
          createdById: assigneeId,
          title: `File AMFI Declaration of Self-Certification — FY ${fy}`,
          status: "open",
          priority: "high",
          dueAt,
          department: "compliance" as any,
          remarks:
            `${marker}\nDDQ 4.26 — the annual DSC must be submitted in AMFI's prescribed format for your own ARN` +
            (subCount > 0 ? `, and obtained from all ${subCount} sub-distributor(s).` : ".") +
            `\nRecord it in Compliance → DDQ compliance registers.`,
        } as any);
        created++;
      });
    } catch (err) {
      console.error(`[dsc-reminder] tenant ${tenantId} failed:`, (err as Error)?.message);
    }
  }

  if (created) console.log(`[dsc-reminder] FY ${fy}: raised ${created} task(s).`);
  return created;
}
