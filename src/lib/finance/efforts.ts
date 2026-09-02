/**
 * EFFORTS tracker service — monthly Plan vs Actual for leading-activity metrics.
 * SERVER-ONLY. Some actuals auto-fill from the CRM (new leads, FBPs); all are
 * editable and stored in effort_entries.
 */

import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { effortEntries } from "@/db/schema";

export type EffortMetric = { key: string; label: string; auto: boolean };

/** Client-safe metric list (mirrored on the client). */
export const EFFORT_METRICS: EffortMetric[] = [
  { key: "internal_reviews", label: "Existing Clients — Internal Reviews", auto: false },
  { key: "review_meetings", label: "Existing Clients — Review Meetings", auto: false },
  { key: "lead_meetings", label: "Leads Meetings", auto: false },
  { key: "iaps_fwps", label: "No. of FWPs / IAPs", auto: false },
  { key: "new_leads", label: "No. of New Leads", auto: true },
  { key: "fbps", label: "No. of FBPs (Financial Plans)", auto: true },
];

export type EffortRow = { key: string; label: string; auto: boolean; planned: number; actual: number; computed: number | null };
export type EffortsStatus = { period: string; rows: EffortRow[] };

const n = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
function periodRange(period: string): { start: string; end: string } {
  const [y, m] = period.split("-").map(Number);
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const end = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { start, end };
}

async function countSafe(tx: Tx, q: ReturnType<typeof sql>): Promise<number | null> {
  try {
    const res = await tx.execute(q);
    return n((res.rows[0] as any)?.c);
  } catch {
    return null;
  }
}

export async function loadEfforts(tx: Tx, period: string): Promise<EffortsStatus> {
  const { start, end } = periodRange(period);

  const saved = await tx.select().from(effortEntries).where(eq(effortEntries.period, period));
  const byKey = new Map(saved.map((r) => [r.metricKey, r]));

  // Auto-computed actuals (suggestions / pull source).
  const newLeads = await countSafe(tx, sql`SELECT COUNT(*)::int AS c FROM leads WHERE created_at >= ${start} AND created_at < ${end}`);
  const fbps = await countSafe(tx, sql`SELECT COUNT(*)::int AS c FROM financial_plans WHERE created_at >= ${start} AND created_at < ${end}`);
  const computedByKey: Record<string, number | null> = { new_leads: newLeads, fbps };

  const rows: EffortRow[] = EFFORT_METRICS.map((m) => {
    const sv = byKey.get(m.key);
    return {
      key: m.key,
      label: m.label,
      auto: m.auto,
      planned: sv ? n(sv.planned) : 0,
      actual: sv ? n(sv.actual) : 0,
      computed: m.auto ? computedByKey[m.key] ?? null : null,
    };
  });

  return { period, rows };
}

export type EffortInput = { metricKey: string; planned: number; actual: number };

export async function saveEfforts(tx: Tx, tenantId: string, period: string, entries: EffortInput[]): Promise<void> {
  for (const e of entries) {
    const [existing] = await tx
      .select({ id: effortEntries.id })
      .from(effortEntries)
      .where(and(eq(effortEntries.period, period), eq(effortEntries.metricKey, e.metricKey)));
    const planned = String(Number.isFinite(e.planned) ? e.planned : 0);
    const actual = String(Number.isFinite(e.actual) ? e.actual : 0);
    if (existing) {
      await tx.update(effortEntries).set({ planned, actual, updatedAt: new Date() }).where(eq(effortEntries.id, existing.id));
    } else {
      await tx.insert(effortEntries).values({ tenantId, period, metricKey: e.metricKey, planned, actual });
    }
  }
}
