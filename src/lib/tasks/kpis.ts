import { sql } from "drizzle-orm";
import { tasks } from "@/db/schema";

/**
 * The Tasks stat-ribbon counts (Open / Due today / Overdue / SLA-at-risk),
 * expressed as reusable aggregate columns. Shared by the web page and the
 * /api/tasks/kpis endpoint so the two can't drift apart. Each caller supplies
 * its own .from()/.leftJoin()/.where() scope; every card pins status='open'.
 */
export const taskKpiSelect = {
  open: sql<number>`count(*) filter (where ${tasks.status} = 'open')::int`,
  today: sql<number>`count(*) filter (where ${tasks.status} = 'open' and ${tasks.dueAt}::date = current_date)::int`,
  overdue: sql<number>`count(*) filter (where ${tasks.status} = 'open' and ${tasks.dueAt} < now())::int`,
  slaRisk: sql<number>`count(*) filter (where ${tasks.status} = 'open' and ${tasks.slaDueAt} is not null and ${tasks.slaDueAt} < now() + interval '24 hours')::int`,
} as const;

export type TaskKpis = { open: number; today: number; overdue: number; slaRisk: number };

export function normalizeTaskKpis(row: any): TaskKpis {
  return {
    open: Number(row?.open ?? 0),
    today: Number(row?.today ?? 0),
    overdue: Number(row?.overdue ?? 0),
    slaRisk: Number(row?.slaRisk ?? 0),
  };
}
