/**
 * Daily Service Tracker (DST) loader.
 *
 * Surfaces the user's active, multi-step tasks (those with sub-tasks) so they
 * can be worked through service-desk style: grouped by status, each showing its
 * sub-task progress and the next action date. Read-only here — editing the
 * sub-tasks happens in the task drawer.
 */

import { sql } from "drizzle-orm";
import { taskChecklist, subTaskStatus, type TaskChecklistItem } from "@/db/schema";

type Tx = { execute: (q: any) => Promise<{ rows: any[] }> };

export type ServiceTask = {
  id: string;
  title: string;
  status: "open" | "in_progress" | "blocked";
  dueAt: string | null;
  for: string | null;
  subtasks: TaskChecklistItem[];
  done: number;
  total: number;
  nextActionDate: string | null;
};

export async function loadServiceTasks(tx: Tx, tenantId: string, userId: string): Promise<ServiceTask[]> {
  const r = await tx.execute(sql`
    SELECT t.id, t.title, t.status, t.due_at, t.meta, i.name AS investor_name, l.name AS lead_name
    FROM tasks t
    LEFT JOIN investors i ON i.id = t.related_investor_id
    LEFT JOIN leads l ON l.id = t.related_lead_id
    WHERE t.tenant_id = ${tenantId}::uuid AND t.assignee_id = ${userId}::uuid
      AND t.status IN ('open','in_progress','blocked')
      AND jsonb_typeof(t.meta -> 'checklist') = 'array'
      AND jsonb_array_length(t.meta -> 'checklist') > 0
    ORDER BY t.due_at ASC NULLS LAST
    LIMIT 200
  `);

  return (r.rows as any[]).map((row) => {
    const subtasks = taskChecklist(row.meta);
    const done = subtasks.filter((c) => subTaskStatus(c) === "completed").length;
    const nextDates = subtasks
      .filter((c) => subTaskStatus(c) !== "completed" && c.actionDate)
      .map((c) => c.actionDate as string)
      .sort();
    return {
      id: String(row.id),
      title: row.title,
      status: row.status,
      dueAt: row.due_at ? new Date(row.due_at).toISOString() : null,
      for: row.investor_name ?? row.lead_name ?? null,
      subtasks,
      done,
      total: subtasks.length,
      nextActionDate: nextDates[0] ?? null,
    };
  });
}
