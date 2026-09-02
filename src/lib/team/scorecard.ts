/**
 * Team Performance — KRA scorecard engine.
 *
 * Computes per-person KPIs for the Sales and Operations teams from data the CRM
 * already holds (business entries, investors, leads, activities, review
 * meetings, service requests, tasks, attendance), scores each KPI, and rolls up
 * a weighted KRA score + RAG band per person.
 *
 * V1 scoring is target-free and robust: count KPIs are scored relative to the
 * team's best (a leaderboard), %-KPIs (SLA / attendance / conversion) are scored
 * on their own absolute value, and "lower-is-better" KPIs (overdue) invert.
 * Per-person absolute targets can layer on later.
 */

import { sql } from "drizzle-orm";
import { currentFiscalYear } from "@/lib/business/sif-status";

type Tx = { execute: (q: any) => Promise<{ rows: any[] }> };

export type KpiUnit = "inr" | "count" | "pct";
export type Kpi = { key: string; label: string; actual: number; unit: KpiUnit; score: number; weight: number; target?: number };
export type MemberRow = { userId: string; name: string; kraScore: number; band: "green" | "amber" | "red"; kpis: Kpi[] };
export type Scorecard = { sales: MemberRow[]; ops: MemberRow[]; from: string; to: string };

/** Metrics that take a per-person annual target (flow KPIs). %/stock/inverse
 *  KPIs (SLA, attendance, AUM, overdue) keep their own absolute/relative score. */
export const TARGETABLE_METRICS: { key: string; label: string; team: "sales" | "ops"; unit: KpiUnit }[] = [
  // Business is split by product so owners can target each line separately.
  // MF + Other come from business_entries (by product_type); Insurance comes
  // from the insurance_policies module (annual premium booked in the period).
  { key: "mf_business", label: "MF business", team: "sales", unit: "inr" },
  { key: "insurance_business", label: "Insurance business", team: "sales", unit: "inr" },
  { key: "other_business", label: "Other products", team: "sales", unit: "inr" },
  { key: "new_clients", label: "New clients", team: "sales", unit: "count" },
  { key: "converted", label: "Leads converted", team: "sales", unit: "count" },
  { key: "meetings", label: "Meetings", team: "sales", unit: "count" },
  { key: "activities", label: "Activities", team: "sales", unit: "count" },
  { key: "tasks_completed", label: "Tasks completed", team: "sales", unit: "count" },
  { key: "resolved", label: "Tickets resolved", team: "ops", unit: "count" },
];

type Mode = "rel" | "pct" | "relInverse";
type KpiDef = { key: string; label: string; unit: KpiUnit; weight: number; mode: Mode; values: Map<string, number>; targetable?: boolean };

const band = (s: number): MemberRow["band"] => (s >= 75 ? "green" : s >= 50 ? "amber" : "red");

async function single(tx: Tx, q: any): Promise<Map<string, number>> {
  const r = await tx.execute(q);
  const m = new Map<string, number>();
  for (const row of r.rows as any[]) if (row.uid) m.set(String(row.uid), Number(row.v) || 0);
  return m;
}
/** met/total → percentage per user. */
async function ratio(tx: Tx, q: any): Promise<Map<string, number>> {
  const r = await tx.execute(q);
  const m = new Map<string, number>();
  for (const row of r.rows as any[]) {
    if (!row.uid) continue;
    const total = Number(row.total) || 0;
    m.set(String(row.uid), total > 0 ? Math.round((Number(row.met) || 0) / total * 100) : 0);
  }
  return m;
}

function assemble(
  users: { id: string; name: string }[],
  defs: KpiDef[],
  targets: Map<string, number>,
  fraction: number
): MemberRow[] {
  const best = new Map<string, number>();
  const worst = new Map<string, number>();
  for (const d of defs) {
    let b = 0;
    let w = 0;
    for (const u of users) {
      const v = d.values.get(u.id) ?? 0;
      if (v > b) b = v;
      if (v > w) w = v;
    }
    best.set(d.key, b);
    worst.set(d.key, w);
  }
  const rows = users.map((u) => {
    const kpis: Kpi[] = defs.map((d) => {
      const actual = d.values.get(u.id) ?? 0;
      const annual = d.targetable ? targets.get(`${u.id}:${d.key}`) : undefined;
      let score: number;
      let target: number | undefined;
      if (annual && annual > 0) {
        target = Math.round(annual * fraction); // pro-rate annual → this period
        score = target > 0 ? Math.min(100, Math.round((actual / target) * 100)) : 0;
      } else if (d.mode === "pct") {
        score = Math.min(100, Math.round(actual));
      } else if (d.mode === "relInverse") {
        score = (worst.get(d.key) ?? 0) > 0 ? Math.round((1 - actual / (worst.get(d.key) || 1)) * 100) : 100;
      } else {
        score = (best.get(d.key) ?? 0) > 0 ? Math.round((actual / (best.get(d.key) || 1)) * 100) : 0;
      }
      return { key: d.key, label: d.label, actual, unit: d.unit, score, weight: d.weight, target };
    });
    const wsum = kpis.reduce((n, k) => n + k.weight, 0) || 1;
    const kraScore = Math.round(kpis.reduce((n, k) => n + k.score * k.weight, 0) / wsum);
    return { userId: u.id, name: u.name, kraScore, band: band(kraScore), kpis };
  });
  return rows.sort((a, b) => b.kraScore - a.kraScore);
}

async function loadTargets(tx: Tx, tenantId: string, fy: string): Promise<Map<string, number>> {
  const r = await tx.execute(
    sql`SELECT user_id, metric_key, annual_target FROM kra_targets WHERE tenant_id = ${tenantId}::uuid AND fiscal_year = ${fy}`
  );
  const m = new Map<string, number>();
  for (const row of r.rows as any[]) m.set(`${String(row.user_id)}:${row.metric_key}`, Number(row.annual_target) || 0);
  return m;
}

export async function loadScorecard(tx: Tx, tenantId: string, from: string, to: string): Promise<Scorecard> {
  const t = tenantId;
  // Timestamp window helper: [from 00:00, to+1 00:00)
  const tsLo = sql`${from}::date`;
  const tsHi = sql`(${to}::date + interval '1 day')`;
  // Per-person targets are stored annually; pro-rate to the selected period.
  const fy = currentFiscalYear();
  const periodDays = Math.max(1, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1);
  const fraction = periodDays / 365;
  const targets = await loadTargets(tx, t, fy);

  const roster = async (predicate: any) =>
    ((await tx.execute(sql`SELECT id, name FROM users WHERE tenant_id = ${t}::uuid AND status = 'active' AND ${predicate} ORDER BY name ASC`)).rows as any[]).map(
      (u) => ({ id: String(u.id), name: u.name ?? "—" })
    );
  const salesUsers = await roster(sql`('rm' = ANY(roles) OR 'branch_head' = ANY(roles))`);
  const opsUsers = await roster(sql`('ops' = ANY(roles) OR 'back_office' = ANY(roles))`);

  // ── Sales KPIs ──────────────────────────────────────────────────────────
  // Business is split by product. MF and "other products" come from
  // business_entries by product_type; insurance comes from the insurance module
  // (annual premium of policies that were actually issued in the period).
  const mfBusiness = await single(tx, sql`SELECT rm_id AS uid, COALESCE(SUM(total_amount),0) AS v FROM business_entries WHERE tenant_id=${t}::uuid AND rm_id IS NOT NULL AND product_type = 'mutual_fund' AND status <> 'cancelled' AND business_date BETWEEN ${from}::date AND ${to}::date GROUP BY rm_id`);
  const otherBusiness = await single(tx, sql`SELECT rm_id AS uid, COALESCE(SUM(total_amount),0) AS v FROM business_entries WHERE tenant_id=${t}::uuid AND rm_id IS NOT NULL AND product_type <> 'mutual_fund' AND status <> 'cancelled' AND business_date BETWEEN ${from}::date AND ${to}::date GROUP BY rm_id`);
  const insuranceBusiness = await single(tx, sql`SELECT sold_by_user_id AS uid, COALESCE(SUM(annual_premium),0) AS v FROM insurance_policies WHERE tenant_id=${t}::uuid AND sold_by_user_id IS NOT NULL AND status NOT IN ('proposed','in_underwriting','cancelled') AND policy_start_date BETWEEN ${from}::date AND ${to}::date GROUP BY sold_by_user_id`);
  const newClients = await single(tx, sql`SELECT rm_id AS uid, count(*) AS v FROM investors WHERE tenant_id=${t}::uuid AND rm_id IS NOT NULL AND merged_into_id IS NULL AND deleted_at IS NULL AND created_at >= ${tsLo} AND created_at < ${tsHi} GROUP BY rm_id`);
  const aum = await single(tx, sql`SELECT rm_id AS uid, COALESCE(SUM(aum),0) AS v FROM investors WHERE tenant_id=${t}::uuid AND rm_id IS NOT NULL AND status='active' AND merged_into_id IS NULL AND deleted_at IS NULL GROUP BY rm_id`);
  const converted = await single(tx, sql`SELECT owner_id AS uid, count(*) AS v FROM leads WHERE tenant_id=${t}::uuid AND owner_id IS NOT NULL AND converted_at >= ${tsLo} AND converted_at < ${tsHi} GROUP BY owner_id`);
  const meetings = await single(tx, sql`SELECT rm_id AS uid, count(*) AS v FROM review_meetings WHERE tenant_id=${t}::uuid AND rm_id IS NOT NULL AND status IN ('completed','confirmed') AND meeting_date >= ${tsLo} AND meeting_date < ${tsHi} GROUP BY rm_id`);
  const activities = await single(tx, sql`SELECT owner_user_id AS uid, count(*) AS v FROM activities WHERE tenant_id=${t}::uuid AND owner_user_id IS NOT NULL AND occurred_at >= ${tsLo} AND occurred_at < ${tsHi} GROUP BY owner_user_id`);
  const tasksCompleted = await single(tx, sql`SELECT assignee_id AS uid, count(*) AS v FROM tasks WHERE tenant_id=${t}::uuid AND assignee_id IS NOT NULL AND status='completed' AND completed_at >= ${tsLo} AND completed_at < ${tsHi} GROUP BY assignee_id`);

  const sales = assemble(salesUsers, [
    // Business split (was a single "net_sales" 0.30) — same total weight, now
    // per product so each can carry its own target. MF leads, then insurance.
    { key: "mf_business", label: "MF business", unit: "inr", weight: 0.15, mode: "rel", values: mfBusiness, targetable: true },
    { key: "insurance_business", label: "Insurance business", unit: "inr", weight: 0.08, mode: "rel", values: insuranceBusiness, targetable: true },
    { key: "other_business", label: "Other products", unit: "inr", weight: 0.07, mode: "rel", values: otherBusiness, targetable: true },
    { key: "new_clients", label: "New clients", unit: "count", weight: 0.2, mode: "rel", values: newClients, targetable: true },
    { key: "converted", label: "Leads converted", unit: "count", weight: 0.15, mode: "rel", values: converted, targetable: true },
    { key: "meetings", label: "Meetings", unit: "count", weight: 0.15, mode: "rel", values: meetings, targetable: true },
    { key: "activities", label: "Activities", unit: "count", weight: 0.1, mode: "rel", values: activities, targetable: true },
    { key: "tasks_completed", label: "Tasks completed", unit: "count", weight: 0.1, mode: "rel", values: tasksCompleted, targetable: true },
    { key: "aum", label: "Book AUM", unit: "inr", weight: 0.1, mode: "rel", values: aum },
  ], targets, fraction);

  // ── Operations KPIs ─────────────────────────────────────────────────────
  const sla = await ratio(tx, sql`SELECT assigned_to_user_id AS uid, count(*) FILTER (WHERE resolved_at <= sla_resolution_at) AS met, count(*) AS total FROM service_requests WHERE tenant_id=${t}::uuid AND assigned_to_user_id IS NOT NULL AND status IN ('resolved','closed') AND resolved_at >= ${tsLo} AND resolved_at < ${tsHi} AND sla_resolution_at IS NOT NULL GROUP BY assigned_to_user_id`);
  const resolved = await single(tx, sql`SELECT assigned_to_user_id AS uid, count(*) AS v FROM service_requests WHERE tenant_id=${t}::uuid AND assigned_to_user_id IS NOT NULL AND status IN ('resolved','closed') AND resolved_at >= ${tsLo} AND resolved_at < ${tsHi} GROUP BY assigned_to_user_id`);
  const overdue = await single(tx, sql`SELECT assignee_id AS uid, count(*) AS v FROM tasks WHERE tenant_id=${t}::uuid AND assignee_id IS NOT NULL AND status IN ('open','in_progress','blocked') AND due_at IS NOT NULL AND due_at < now() GROUP BY assignee_id`);
  const attendance = await ratio(tx, sql`SELECT employee_user_id AS uid, count(*) FILTER (WHERE clock_in_at IS NOT NULL OR status='present') AS met, count(*) AS total FROM attendance WHERE tenant_id=${t}::uuid AND employee_user_id IS NOT NULL AND attendance_date BETWEEN ${from}::date AND ${to}::date GROUP BY employee_user_id`);

  const ops = assemble(opsUsers, [
    { key: "sla", label: "SLA adherence", unit: "pct", weight: 0.35, mode: "pct", values: sla },
    { key: "resolved", label: "Tickets resolved", unit: "count", weight: 0.25, mode: "rel", values: resolved, targetable: true },
    { key: "overdue", label: "Overdue tasks", unit: "count", weight: 0.2, mode: "relInverse", values: overdue },
    { key: "attendance", label: "Attendance", unit: "pct", weight: 0.2, mode: "pct", values: attendance },
  ], targets, fraction);

  return { sales, ops, from, to };
}
