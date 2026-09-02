/**
 * Daily Job Tracker (DJT) service.
 *
 * The DJT splits each day into "productive & completed" vs "non-productive &
 * incomplete" work, a key learning, today's plan, plus breakdown/breakthrough.
 * We DERIVE the two work lists from the user's tasks (completed yesterday vs
 * carried-over) and persist only the reflective + planning fields.
 */

import { sql } from "drizzle-orm";

type Tx = { execute: (q: any) => Promise<{ rows: any[] }> };

export type FocusItem = { text: string; taskId?: string; done?: boolean; forType?: "client" | "lead" | "other" };

export type DailyTrackerData = {
  date: string;
  keyLearning: string;
  breakdown: string;
  breakthrough: string;
  todayFocus: FocusItem[];
  completedYesterday: { id: string; title: string; for: string | null; at: string | null }[];
  incompleteCarried: { id: string; title: string; dueAt: string | null; priority: string }[];
  dueToday: { id: string; title: string; priority: string; for: string | null }[];
  productivityPct: number;
};

export async function loadDailyTracker(
  tx: Tx,
  tenantId: string,
  userId: string,
  dateISO: string
): Promise<DailyTrackerData> {
  const tr = await tx.execute(sql`
    SELECT key_learning, breakdown, breakthrough, today_focus
    FROM daily_trackers
    WHERE tenant_id = ${tenantId}::uuid AND user_id = ${userId}::uuid AND tracker_date = ${dateISO}::date
    LIMIT 1
  `);
  const saved = tr.rows[0] as any;

  // 1. Productive & completed — tasks the user finished the day before.
  const comp = await tx.execute(sql`
    SELECT t.id, t.title, t.completed_at, i.name AS investor_name, l.name AS lead_name
    FROM tasks t
    LEFT JOIN investors i ON i.id = t.related_investor_id
    LEFT JOIN leads l ON l.id = t.related_lead_id
    WHERE t.tenant_id = ${tenantId}::uuid AND t.assignee_id = ${userId}::uuid
      AND t.status = 'completed'
      AND t.completed_at >= (${dateISO}::date - interval '1 day')
      AND t.completed_at <  ${dateISO}::date
    ORDER BY t.completed_at DESC
    LIMIT 100
  `);

  // 2. Non-productive & incomplete — carried-over (overdue, still open).
  const inc = await tx.execute(sql`
    SELECT id, title, due_at, priority
    FROM tasks
    WHERE tenant_id = ${tenantId}::uuid AND assignee_id = ${userId}::uuid
      AND status IN ('open','in_progress','blocked')
      AND due_at IS NOT NULL AND due_at < ${dateISO}::date
    ORDER BY due_at ASC
    LIMIT 100
  `);

  // 4. Suggestions for "today's important work" — what's due today.
  const due = await tx.execute(sql`
    SELECT t.id, t.title, t.priority, i.name AS investor_name, l.name AS lead_name
    FROM tasks t
    LEFT JOIN investors i ON i.id = t.related_investor_id
    LEFT JOIN leads l ON l.id = t.related_lead_id
    WHERE t.tenant_id = ${tenantId}::uuid AND t.assignee_id = ${userId}::uuid
      AND t.status IN ('open','in_progress','blocked')
      AND t.due_at::date = ${dateISO}::date
    ORDER BY case t.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end
    LIMIT 100
  `);

  const completedYesterday = comp.rows.map((r: any) => ({
    id: String(r.id),
    title: r.title,
    for: r.investor_name ?? r.lead_name ?? null,
    at: r.completed_at ? new Date(r.completed_at).toISOString() : null,
  }));
  const incompleteCarried = inc.rows.map((r: any) => ({
    id: String(r.id),
    title: r.title,
    dueAt: r.due_at ? new Date(r.due_at).toISOString() : null,
    priority: r.priority,
  }));
  const dueToday = due.rows.map((r: any) => ({
    id: String(r.id),
    title: r.title,
    priority: r.priority,
    for: r.investor_name ?? r.lead_name ?? null,
  }));

  const denom = completedYesterday.length + incompleteCarried.length;
  const productivityPct = denom > 0 ? Math.round((completedYesterday.length / denom) * 100) : 0;

  return {
    date: dateISO,
    keyLearning: saved?.key_learning ?? "",
    breakdown: saved?.breakdown ?? "",
    breakthrough: saved?.breakthrough ?? "",
    todayFocus: Array.isArray(saved?.today_focus) ? (saved.today_focus as FocusItem[]) : [],
    completedYesterday,
    incompleteCarried,
    dueToday,
    productivityPct,
  };
}

export async function saveDailyTracker(
  tx: Tx,
  tenantId: string,
  userId: string,
  dateISO: string,
  data: { keyLearning: string; breakdown: string; breakthrough: string; todayFocus: FocusItem[] }
): Promise<void> {
  await tx.execute(sql`
    INSERT INTO daily_trackers (tenant_id, user_id, tracker_date, key_learning, breakdown, breakthrough, today_focus)
    VALUES (${tenantId}::uuid, ${userId}::uuid, ${dateISO}::date, ${data.keyLearning || null}, ${data.breakdown || null}, ${data.breakthrough || null}, ${JSON.stringify(data.todayFocus ?? [])}::jsonb)
    ON CONFLICT (tenant_id, user_id, tracker_date)
    DO UPDATE SET
      key_learning = excluded.key_learning,
      breakdown = excluded.breakdown,
      breakthrough = excluded.breakthrough,
      today_focus = excluded.today_focus,
      updated_at = now()
  `);
}
