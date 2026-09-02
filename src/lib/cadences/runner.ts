/**
 * Cadence runner — materialise due cadence steps into real tasks / activities
 * and advance each enrollment to its next step. Called by a daily worker (or
 * the run-due endpoint). Tenant-scoped via the caller's transaction.
 */

import { sql } from "drizzle-orm";
import { v4 as uuid } from "uuid";

type Tx = { execute: (q: any) => Promise<{ rows: any[] }> };

export async function advanceDueCadences(tx: Tx, tenantId: string): Promise<number> {
  const due = (await tx.execute(sql`
    SELECT e.id, e.cadence_id, e.subject_type, e.subject_id, e.subject_name, e.current_step,
           e.enrolled_by_user_id, e.created_at, c.steps
    FROM cadence_enrollments e JOIN cadences c ON c.id = e.cadence_id
    WHERE e.tenant_id = ${tenantId}::uuid AND e.status = 'active'
      AND e.next_run_at IS NOT NULL AND e.next_run_at <= now()
    LIMIT 200
  `)).rows as any[];

  let materialised = 0;
  for (const e of due) {
    const steps: any[] = Array.isArray(e.steps) ? e.steps : [];
    let cur = Number(e.current_step || 0);
    // Process every step whose scheduled time (created_at + dayOffset) has passed.
    while (cur < steps.length) {
      const step = steps[cur];
      const scheduledPassed = (await tx.execute(sql`SELECT (${e.created_at}::timestamptz + (${Number(step.dayOffset || 0)} || ' days')::interval) <= now() AS due`)).rows[0]?.due;
      if (!scheduledPassed) break;

      if (step.action === "task" || step.action === "reminder") {
        await tx.execute(sql`
          INSERT INTO tasks (id, tenant_id, type, title, priority, status, assignee_id, created_by_id, due_at, subject_type, subject_id, ${sql.raw(e.subject_type === "investor" ? "related_investor_id" : "related_lead_id")})
          VALUES (${uuid()}::uuid, ${tenantId}::uuid, 'custom', ${String(step.title ?? "Cadence step").slice(0, 200)}, 'normal', 'open', ${e.enrolled_by_user_id}::uuid, ${e.enrolled_by_user_id}::uuid, now(), ${e.subject_type}, ${e.subject_id}::uuid, ${e.subject_id}::uuid)`);
      } else if (step.action === "log_touch") {
        await tx.execute(sql`
          INSERT INTO activities (id, tenant_id, subject_type, subject_id, subject_name, kind, subject, notes, occurred_at, owner_user_id)
          VALUES (${uuid()}::uuid, ${tenantId}::uuid, ${e.subject_type}, ${e.subject_id}::uuid, ${e.subject_name ?? null}, ${step.channel ?? "note"}, ${String(step.title ?? "Cadence touch").slice(0, 200)}, ${String(step.notes ?? "").slice(0, 1000) || null}, now(), ${e.enrolled_by_user_id}::uuid)`);
      }
      materialised++;
      cur++;
    }

    if (cur >= steps.length) {
      await tx.execute(sql`UPDATE cadence_enrollments SET current_step = ${cur}, status = 'completed', next_run_at = NULL, updated_at = now() WHERE id = ${e.id}::uuid`);
    } else {
      await tx.execute(sql`UPDATE cadence_enrollments SET current_step = ${cur}, next_run_at = ${e.created_at}::timestamptz + (${Number(steps[cur].dayOffset || 0)} || ' days')::interval, updated_at = now() WHERE id = ${e.id}::uuid`);
    }
  }
  return materialised;
}
