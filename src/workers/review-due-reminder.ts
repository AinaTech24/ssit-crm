/**
 * Client review-due reminder.
 *
 * A review cadence (monthly / quarterly / every 100 days / yearly) only helps if
 * something actually prompts the RM when the date arrives. investors.next_review_at
 * was driving a dashboard badge but raised no task, so a due review could pass
 * unnoticed.
 *
 * This raises ONE task per client per review cycle, assigned to that client's RM
 * (falling back to the firm's owner/compliance user). Cadence-agnostic: it reads
 * next_review_at, so it works for the presets and for any custom day count.
 *
 * It also raises an in-app (bell) notification naming the client, so the RM is
 * told without having to go looking at the task list. The task is raised a week
 * ahead as prep; the notification fires on/after the due date itself — i.e. a
 * client reviewed today with a 100-day cadence pings the RM 100 days later.
 *
 * Idempotent — the task carries a marker keyed on the client + the review date,
 * and the notification is keyed on the same pair in its meta, so re-running
 * never duplicates and the NEXT cycle gets its own pair because the date moves.
 */

import { sql } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import { withSystem, withTenant } from "@/db/client";
import { tasks } from "@/db/schema";
import { createNotification } from "@/lib/notifications/create";

/** How many days ahead of the due date to raise the task. */
const LEAD_DAYS = 7;

export async function runReviewDueReminder(): Promise<number> {
  let created = 0;
  let notified = 0;

  const tenantIds = await withSystem(async (tx) => {
    const r = await tx.execute(
      sql`SELECT id FROM tenants WHERE status IN ('active','trial') AND deleted_at IS NULL`
    );
    return (r.rows as any[]).map((x) => x.id as string);
  });

  for (const tenantId of tenantIds) {
    try {
      await withTenant(tenantId, async (tx) => {
        // Clients whose review falls due within the lead window (or is overdue).
        const due = await tx.execute(sql`
          SELECT i.id, i.name, i.rm_id,
                 to_char(i.next_review_at, 'YYYY-MM-DD') AS due_on,
                 to_char(i.last_review_at, 'YYYY-MM-DD') AS last_on,
                 (i.next_review_at::date <= current_date) AS due_now
            FROM investors i
           WHERE i.tenant_id = ${tenantId}::uuid
             AND i.deleted_at IS NULL
             AND i.status = 'active'
             AND i.merged_into_id IS NULL
             AND i.next_review_at IS NOT NULL
             AND i.next_review_at::date <= (current_date + make_interval(days => ${LEAD_DAYS}))
           LIMIT 500`);
        if (!due.rows.length) return;

        // Fallback assignee when the client has no RM.
        const fb = await tx.execute(sql`
          SELECT id FROM users
           WHERE tenant_id = ${tenantId}::uuid AND status = 'active'
             AND ('owner' = ANY(roles) OR 'compliance' = ANY(roles))
           ORDER BY ('owner' = ANY(roles)) DESC LIMIT 1`);
        const fallbackId = (fb.rows[0] as any)?.id as string | undefined;

        for (const row of due.rows as any[]) {
          const assigneeId = (row.rm_id as string) ?? fallbackId;
          if (!assigneeId) continue;

          // One task per client per review date.
          const marker = `[review-due:${row.id}:${row.due_on}]`;
          const exists = await tx.execute(sql`
            SELECT 1 FROM tasks
             WHERE tenant_id = ${tenantId}::uuid
               AND COALESCE(remarks,'') LIKE ${`${marker}%`}
             LIMIT 1`);

          // The bell alert is raised independently of the task: an existing
          // task must not swallow the notification (and vice versa).
          if (row.due_now) {
            const dupe = await tx.execute(sql`
              SELECT 1 FROM notifications
               WHERE tenant_id = ${tenantId}::uuid
                 AND user_id = ${assigneeId}::uuid
                 AND kind = 'review.due'
                 AND meta->>'investorId' = ${row.id}
                 AND meta->>'dueOn' = ${String(row.due_on)}
               LIMIT 1`);
            if (!dupe.rows.length) {
              await createNotification(tx, {
                tenantId,
                userId: assigneeId,
                kind: "review.due",
                title: `Portfolio review due — ${row.name}`,
                body: row.last_on
                  ? `Last reviewed on ${row.last_on}; the cadence falls due on ${row.due_on}.`
                  : `The review cadence falls due on ${row.due_on}.`,
                linkUrl: `/dashboard/investors/${row.id}`,
                severity: "warning",
                meta: {
                  source: "review_due",
                  investorId: row.id,
                  investorName: row.name,
                  dueOn: String(row.due_on),
                },
              });
              notified++;
            }
          }

          if (exists.rows.length) continue;

          await tx.insert(tasks).values({
            id: uuid(),
            tenantId,
            subjectType: "investor",
            // NOT NULL with no DB default — omitting it is what made every
            // insert fail (23502) and roll the whole tenant batch back.
            type: "review_meeting",
            subjectId: row.id,
            relatedInvestorId: row.id,
            assigneeId,
            createdById: assigneeId,
            title: `Portfolio review due — ${row.name}`,
            status: "open",
            priority: "normal",
            dueAt: new Date(`${row.due_on}T12:00:00`),
            remarks:
              `${marker}\nThe client's review cadence falls due on ${row.due_on}. ` +
              `Book the review, then log it on the client so the next one is scheduled automatically.`,
          } as any);
          created++;
        }
      });
    } catch (err) {
      // Drizzle wraps the driver error, and its own message is just the SQL +
      // params — the actual reason (constraint, RLS, type) lives on .cause.
      // Without this a real failure reads as an unexplained query dump.
      const e = err as any;
      const cause = e?.cause?.message ?? e?.detail ?? "";
      console.error(
        `[review-due] tenant ${tenantId} failed: ${e?.cause?.code ?? e?.code ?? ""} ${cause || e?.message}`.trim()
      );
    }
  }

  if (created || notified) {
    console.log(`[review-due] raised ${created} review task(s), ${notified} notification(s).`);
  }
  return created;
}
