/**
 * Task reminder + overdue + approval-escalation scanner.
 *
 * Every few minutes it sweeps all active tenants and, per task:
 *
 *   OVERDUE   → in-app alert to the assignee (guaranteed) + a one-time
 *               `task.overdue` event on events_outbox (for the escalation
 *               recipe) + a best-effort email. `overdue_notified_at` dedups.
 *
 *   REMINDER  → in-app alert (+ email) to the assignee at `remind_at`;
 *               `reminder_fired_at` dedups (cleared when the reminder is edited).
 *
 *   STALE APPROVAL → when a task has sat in `approval_status='pending'` for
 *               >24h, nudge the approver (creator) once; `approval_escalated_at`
 *               dedups.
 *
 * Loop-safety: task CREATION emits no events; `task.overdue` is terminal +
 * notify-only, so it can't feed an automation loop.
 */

import { sql } from "drizzle-orm";
import { withSystem, withTenant } from "@/db/client";
import { eventsOutbox } from "@/db/schema";
import { createNotification } from "@/lib/notifications/create";
import { sendStaffEmails, type StaffEmailJob } from "@/lib/tasks/staff-email";

function fmtDue(due: string | Date | null): string {
  if (!due) return "";
  const d = typeof due === "string" ? new Date(due) : due;
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

async function listActiveTenants(): Promise<string[]> {
  return withSystem(async (tx) => {
    const r = await tx.execute(sql`SELECT id FROM tenants WHERE status IN ('active', 'trial')`);
    return (r.rows as Array<{ id: string }>).map((row) => row.id);
  });
}

type ScanOut = { count: number; emails: StaffEmailJob[] };

/** Fire one-time overdue alerts for a tenant. */
async function scanTenantOverdue(tenantId: string): Promise<ScanOut> {
  const emails: StaffEmailJob[] = [];
  const count = await withTenant(tenantId, async (tx) => {
    const rows = (
      await tx.execute(sql`
        SELECT t.id, t.title, t.due_at, t.priority, t.assignee_id,
               u.name AS assignee_name, u.email AS assignee_email, u.phone AS assignee_phone,
               u.reporting_manager_id AS assignee_rm_id
        FROM tasks t
        LEFT JOIN users u ON u.id = t.assignee_id
        WHERE t.tenant_id = ${tenantId}::uuid
          AND t.deleted_at IS NULL
          AND t.status IN ('open', 'in_progress', 'blocked')
          AND t.due_at IS NOT NULL AND t.due_at < now()
          AND t.overdue_notified_at IS NULL
        ORDER BY t.due_at ASC
        LIMIT 500
      `)
    ).rows as Array<{
      id: string; title: string; due_at: string; priority: string;
      assignee_id: string | null; assignee_name: string | null; assignee_email: string | null;
      assignee_phone: string | null; assignee_rm_id: string | null;
    }>;

    for (const r of rows) {
      if (r.assignee_id) {
        await createNotification(tx, {
          tenantId,
          userId: r.assignee_id,
          kind: "task.overdue",
          severity: "warning",
          title: `Overdue: ${r.title}`,
          body: `This task was due ${fmtDue(r.due_at)} and is still open. Action it or reschedule.`,
          linkUrl: "/dashboard/tasks?due=overdue",
          meta: { task_id: r.id },
        });
      }
      emails.push({
        email: r.assignee_email,
        subject: `Overdue task: ${r.title}`,
        text: `Your task "${r.title}" was due ${fmtDue(r.due_at)} and is still open.\n\nAction it or reschedule: /dashboard/tasks?due=overdue`,
        key: `task-overdue:${r.id}`,
      });
      await tx
        .insert(eventsOutbox)
        .values({
          tenantId,
          kind: "task.overdue",
          entityType: "task",
          entityId: r.id,
          after: {
            title: r.title, due_at: r.due_at, priority: r.priority,
            assignee_id: r.assignee_id, assignee_name: r.assignee_name,
            assignee_phone: r.assignee_phone, assignee_rm_id: r.assignee_rm_id,
          } as any,
          meta: { source: "task-reminder-scanner" } as any,
        } as any);
      await tx.execute(sql`UPDATE tasks SET overdue_notified_at = now() WHERE id = ${r.id}::uuid AND tenant_id = ${tenantId}::uuid`);
    }
    return rows.length;
  });
  return { count, emails };
}

/** Fire due per-task reminders for a tenant. */
async function scanTenantReminders(tenantId: string): Promise<ScanOut> {
  const emails: StaffEmailJob[] = [];
  const count = await withTenant(tenantId, async (tx) => {
    const rows = (
      await tx.execute(sql`
        SELECT t.id, t.title, t.due_at, t.assignee_id, u.email AS assignee_email
        FROM tasks t
        LEFT JOIN users u ON u.id = t.assignee_id
        WHERE t.tenant_id = ${tenantId}::uuid
          AND t.deleted_at IS NULL
          AND t.status IN ('open', 'in_progress', 'blocked')
          AND t.remind_at IS NOT NULL AND t.remind_at <= now()
          AND t.reminder_fired_at IS NULL
        ORDER BY t.remind_at ASC
        LIMIT 500
      `)
    ).rows as Array<{ id: string; title: string; due_at: string | null; assignee_id: string | null; assignee_email: string | null }>;

    for (const r of rows) {
      if (r.assignee_id) {
        await createNotification(tx, {
          tenantId,
          userId: r.assignee_id,
          kind: "task.reminder",
          severity: "info",
          title: `Reminder: ${r.title}`,
          body: r.due_at ? `Due ${fmtDue(r.due_at)}.` : "You set a reminder for this task.",
          linkUrl: "/dashboard/tasks?view=assigned_to_me",
          meta: { task_id: r.id },
        });
      }
      emails.push({
        email: r.assignee_email,
        subject: `Task reminder: ${r.title}`,
        text: `Reminder for your task "${r.title}".${r.due_at ? ` Due ${fmtDue(r.due_at)}.` : ""}\n\n/dashboard/tasks?view=assigned_to_me`,
        key: `task-reminder:${r.id}`,
      });
      await tx.execute(sql`UPDATE tasks SET reminder_fired_at = now() WHERE id = ${r.id}::uuid AND tenant_id = ${tenantId}::uuid`);
    }
    return rows.length;
  });
  return { count, emails };
}

/** Nudge approvers when a task has waited >24h for sign-off. */
async function scanTenantApprovalEscalations(tenantId: string): Promise<number> {
  return withTenant(tenantId, async (tx) => {
    const rows = (
      await tx.execute(sql`
        SELECT t.id, t.title, t.created_by_id, t.submitted_at
        FROM tasks t
        WHERE t.tenant_id = ${tenantId}::uuid
          AND t.deleted_at IS NULL
          AND t.approval_status = 'pending'
          AND t.submitted_at IS NOT NULL AND t.submitted_at < now() - interval '24 hours'
          AND t.approval_escalated_at IS NULL
        ORDER BY t.submitted_at ASC
        LIMIT 500
      `)
    ).rows as Array<{ id: string; title: string; created_by_id: string | null; submitted_at: string }>;

    for (const r of rows) {
      if (r.created_by_id) {
        await createNotification(tx, {
          tenantId,
          userId: r.created_by_id,
          kind: "task.approval_stale",
          severity: "warning",
          title: `Approval waiting 24h+: ${r.title}`,
          body: `A task has been awaiting your sign-off since ${fmtDue(r.submitted_at)}.`,
          linkUrl: "/dashboard/tasks?approval=mine",
          meta: { task_id: r.id },
        });
      }
      await tx.execute(sql`UPDATE tasks SET approval_escalated_at = now() WHERE id = ${r.id}::uuid AND tenant_id = ${tenantId}::uuid`);
    }
    return rows.length;
  });
}

export async function runTaskReminderScan(): Promise<{ overdue: number; reminders: number; escalations: number }> {
  const tenants = await listActiveTenants();
  let overdue = 0;
  let reminders = 0;
  let escalations = 0;
  for (const t of tenants) {
    const emailJobs: StaffEmailJob[] = [];
    try {
      const r = await scanTenantOverdue(t);
      overdue += r.count;
      emailJobs.push(...r.emails);
    } catch (err) {
      console.error(`[task-scan] overdue scan failed for tenant ${t}:`, (err as Error).message);
    }
    try {
      const r = await scanTenantReminders(t);
      reminders += r.count;
      emailJobs.push(...r.emails);
    } catch (err) {
      console.error(`[task-scan] reminder scan failed for tenant ${t}:`, (err as Error).message);
    }
    try {
      escalations += await scanTenantApprovalEscalations(t);
    } catch (err) {
      console.error(`[task-scan] approval-escalation scan failed for tenant ${t}:`, (err as Error).message);
    }
    // Best-effort staff email — sent outside the scan transactions.
    if (emailJobs.length) {
      try {
        await sendStaffEmails(t, emailJobs);
      } catch (err) {
        console.error(`[task-scan] staff email send failed for tenant ${t}:`, (err as Error).message);
      }
    }
  }
  return { overdue, reminders, escalations };
}

export function startTaskReminderScannerWorker() {
  const interval = Number(process.env.TASK_SCAN_INTERVAL_MS ?? 5 * 60 * 1000); // 5 min
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await runTaskReminderScan();
      if (r.overdue || r.reminders || r.escalations) {
        console.log(`[task-scan] overdue=${r.overdue} reminders=${r.reminders} escalations=${r.escalations}`);
      }
    } catch (err) {
      console.error("[task-scan] tick failed:", (err as Error).message);
    } finally {
      running = false;
    }
  };
  const handle = setInterval(tick, interval);
  handle.unref?.();
  if (process.env.TASK_SCAN_ON_BOOT === "1") void tick();
  console.log(`[task-scan] started (interval=${interval}ms)`);
  return () => clearInterval(handle);
}
