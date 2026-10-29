/**
 * Targets & achievements.
 *
 * The admin sets a monthly target per person / branch / desk and per metric; the
 * achievement is computed live from the records for that month. Only the target
 * lives in `target_goals` (migration 0245).
 */

import { sql } from "drizzle-orm";

type Rec = Record<string, any>;
export type TargetMetric = {
  key: string;
  label: string;
  unit: "count" | "inr";
  /** A balance at a point in time (the book today) rather than a total for the month. */
  snapshot?: boolean;
  hint: string;
};

export const TARGET_METRICS: TargetMetric[] = [
  { key: "leads", label: "Leads", unit: "count", hint: "New leads added" },
  { key: "meetings", label: "Meetings", unit: "count", hint: "Meetings completed" },
  { key: "new_clients", label: "New clients", unit: "count", hint: "Clients onboarded" },
  { key: "tasks", label: "Tasks", unit: "count", hint: "Tasks completed" },
  { key: "business", label: "Business", unit: "inr", hint: "Business booked (transactions)" },
  { key: "sip", label: "SIP", unit: "inr", hint: "New monthly SIP amount started" },
  { key: "aum", label: "AUM", unit: "inr", snapshot: true, hint: "Book AUM today" },
];

export const METRIC_BY_KEY = new Map(TARGET_METRICS.map((m) => [m.key, m]));

export type SubjectType = "user" | "branch" | "desk";

/** 'YYYY-MM' → first and last day of that month, as 'YYYY-MM-DD'. */
export function monthRange(period: string): { from: string; to: string } {
  const [y, m] = period.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, "0");
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, "0")}` };
}

/** Current month in India time — UTC would still say last month until 5:30 am on the 1st. */
export const currentPeriod = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7);
export const validPeriod = (p: unknown): p is string => typeof p === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(p);

/** metric → (user id → value) for one month. */
export async function loadUserActuals(
  tx: any,
  tenantId: string,
  period: string
): Promise<Map<string, Map<string, number>>> {
  const { from, to } = monthRange(period);
  const t = tenantId;
  const lo = sql`${from}::date`;
  const hi = sql`(${to}::date + interval '1 day')`;

  const q = async (query: any) => {
    const m = new Map<string, number>();
    const r = await tx.execute(query);
    for (const row of r.rows as Rec[]) if (row.uid) m.set(String(row.uid), Number(row.v) || 0);
    return m;
  };

  const [leads, meetings, newClients, tasks, business, sip, aum] = await Promise.all([
    q(sql`SELECT owner_id AS uid, count(*) AS v FROM leads WHERE tenant_id=${t}::uuid AND owner_id IS NOT NULL AND deleted_at IS NULL AND lost_reason IS DISTINCT FROM '__deleted__' AND created_at >= ${lo} AND created_at < ${hi} GROUP BY owner_id`),
    q(sql`SELECT COALESCE(created_by_id, rm_id) AS uid, count(*) AS v FROM review_meetings WHERE tenant_id=${t}::uuid AND status IN ('completed','confirmed') AND meeting_date >= ${lo} AND meeting_date < ${hi} AND COALESCE(created_by_id, rm_id) IS NOT NULL GROUP BY 1`),
    q(sql`SELECT rm_id AS uid, count(*) AS v FROM investors WHERE tenant_id=${t}::uuid AND rm_id IS NOT NULL AND merged_into_id IS NULL AND deleted_at IS NULL AND created_at >= ${lo} AND created_at < ${hi} GROUP BY rm_id`),
    q(sql`SELECT assignee_id AS uid, count(*) AS v FROM tasks WHERE tenant_id=${t}::uuid AND assignee_id IS NOT NULL AND status='completed' AND completed_at >= ${lo} AND completed_at < ${hi} GROUP BY assignee_id`),
    q(sql`SELECT rm_id AS uid, COALESCE(SUM(total_amount),0) AS v FROM business_entries WHERE tenant_id=${t}::uuid AND rm_id IS NOT NULL AND status <> 'cancelled' AND business_date BETWEEN ${from}::date AND ${to}::date GROUP BY rm_id`),
    q(sql`SELECT i.rm_id AS uid, COALESCE(SUM(s.amount),0) AS v FROM sips s JOIN investors i ON i.id = s.investor_id WHERE s.tenant_id=${t}::uuid AND i.rm_id IS NOT NULL AND s.start_date BETWEEN ${from}::date AND ${to}::date GROUP BY i.rm_id`),
    q(sql`SELECT rm_id AS uid, COALESCE(SUM(aum),0) AS v FROM investors WHERE tenant_id=${t}::uuid AND rm_id IS NOT NULL AND status='active' AND merged_into_id IS NULL AND deleted_at IS NULL GROUP BY rm_id`),
  ]);
  return new Map([
    ["leads", leads],
    ["meetings", meetings],
    ["new_clients", newClients],
    ["tasks", tasks],
    ["business", business],
    ["sip", sip],
    ["aum", aum],
  ]);
}

/** Active users grouped for roll-up: branch id → user ids, desk id → user ids. */
export async function loadMembership(tx: any, tenantId: string) {
  const r = await tx.execute(sql`
    SELECT id, name, roles, branch_id, desk_id FROM users
     WHERE tenant_id = ${tenantId}::uuid AND status = 'active'
  `);
  const users = r.rows as { id: string; name: string | null; roles: string[] | null; branch_id: string | null; desk_id: string | null }[];
  const byBranch = new Map<string, string[]>();
  const byDesk = new Map<string, string[]>();
  for (const u of users) {
    if (u.branch_id) (byBranch.get(u.branch_id) ?? byBranch.set(u.branch_id, []).get(u.branch_id)!).push(u.id);
    if (u.desk_id) (byDesk.get(u.desk_id) ?? byDesk.set(u.desk_id, []).get(u.desk_id)!).push(u.id);
  }
  return { users, byBranch, byDesk };
}

export type TargetRow = {
  subjectType: SubjectType;
  subjectId: string;
  metricKey: string;
  targetValue: number;
  visible: boolean;
};

export function achievementFor(
  actuals: Map<string, Map<string, number>>,
  membership: { byBranch: Map<string, string[]>; byDesk: Map<string, string[]> },
  row: Pick<TargetRow, "subjectType" | "subjectId" | "metricKey">
): number {
  const perUser = actuals.get(row.metricKey);
  if (!perUser) return 0;
  const ids =
    row.subjectType === "user"
      ? [row.subjectId]
      : (row.subjectType === "branch" ? membership.byBranch : membership.byDesk).get(row.subjectId) ?? [];
  let total = 0;
  for (const id of ids) total += perUser.get(id) ?? 0;
  return total;
}
