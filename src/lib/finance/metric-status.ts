/**
 * Monthly branch-metric service — assembles + persists the branch-wise MIS
 * reports ("AUM Status", "SIP Book Size", …). SERVER-ONLY (imports the DB).
 *
 * Each (metricKey × period) has one row per source:
 *   - branch   → branchId set; value pre-filled from the live CRM rollup for that
 *                metric (see LIVE_SOURCE), editable to the firm's authoritative
 *                figure before saving.
 *   - external → branchId null, sourceName set (e.g. "Reliance Securities") —
 *                entered manually.
 *
 * value/target are in the metric's display unit (Cr / Lakh / …). targetNum is the
 * FY annual target, carried forward from the most recent prior month. The report
 * computes % achievement (value ÷ target) and the month-on-month delta.
 */

import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { metricSnapshots, branches } from "@/db/schema";
import { METRICS, type MetricKey } from "./metric-config";

/**
 * Per-metric live rollup: the investors column to SUM by branch. Column names
 * here are a fixed whitelist (never user input) so sql.raw is safe.
 */
const LIVE_SOURCE: Record<MetricKey, { column: string }> = {
  aum: { column: "aum" },
  sip_book: { column: "active_sip_amount" },
};

export type MetricRow = {
  sourceType: "branch" | "external";
  branchId: string | null;
  name: string;
  target: number | null;
  value: number;
  prevValue: number | null;
  /** Live rollup value for this branch (display unit) — for "reset to CRM". */
  liveValue?: number;
};

export type MetricStatus = {
  metricKey: MetricKey;
  period: string;
  prevPeriod: string;
  asOnLabel: string;
  prevAsOnLabel: string;
  branches: MetricRow[];
  externals: MetricRow[];
  saved: boolean;
};

/** 'YYYY-MM' → previous month 'YYYY-MM'. */
export function prevPeriodOf(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** 'YYYY-MM' → 'DD/MM/YYYY' of the last day of that month. */
export function monthEndLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${String(last).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

/** The current month as 'YYYY-MM'. */
export function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const n = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

/** Live metric value (display unit) summed by branch from investors.<column>. */
export async function liveByBranch(tx: Tx, metricKey: MetricKey): Promise<Map<string, number>> {
  const col = LIVE_SOURCE[metricKey].column;
  const divisor = METRICS[metricKey].rupeesPerUnit;
  const res = await tx.execute(sql`
    SELECT branch_id, COALESCE(SUM(${sql.raw(col)}), 0)::numeric AS total
      FROM investors
     WHERE branch_id IS NOT NULL AND deleted_at IS NULL
     GROUP BY branch_id
  `);
  const map = new Map<string, number>();
  for (const r of res.rows as Array<{ branch_id: string; total: string | number }>) {
    if (r.branch_id) map.set(String(r.branch_id), n(r.total) / divisor);
  }
  return map;
}

type SnapRow = typeof metricSnapshots.$inferSelect;

async function rowsFor(tx: Tx, metricKey: MetricKey, period: string): Promise<SnapRow[]> {
  return tx
    .select()
    .from(metricSnapshots)
    .where(and(eq(metricSnapshots.metricKey, metricKey), eq(metricSnapshots.period, period)));
}

/** Most recent period strictly before `period` (for this metric) that has rows. */
async function latestPriorPeriod(tx: Tx, metricKey: MetricKey, period: string): Promise<string | null> {
  const res = await tx.execute(sql`
    SELECT MAX(period) AS p FROM metric_snapshots
     WHERE metric_key = ${metricKey} AND period < ${period}
  `);
  return (res.rows[0] as { p: string | null } | undefined)?.p ?? null;
}

/**
 * Assemble the metric status view for (metricKey × period). If no snapshot is
 * saved yet, branch values are pre-filled live and targets + the external-source
 * list are carried forward from the most recent prior month.
 */
export async function loadMetricStatus(
  tx: Tx,
  metricKey: MetricKey,
  period: string
): Promise<MetricStatus> {
  const prevPeriod = prevPeriodOf(period);

  // A withTenant() tx is one pg connection — queries run sequentially.
  const allBranches = await tx
    .select({ id: branches.id, name: branches.name })
    .from(branches)
    .orderBy(branches.name);
  const savedRows = await rowsFor(tx, metricKey, period);
  const prevRows = await rowsFor(tx, metricKey, prevPeriod);
  const live = await liveByBranch(tx, metricKey);

  const saved = savedRows.length > 0;
  const priorPeriod = saved ? null : await latestPriorPeriod(tx, metricKey, period);
  const priorRows = priorPeriod ? await rowsFor(tx, metricKey, priorPeriod) : [];

  const savedByBranch = new Map(savedRows.filter((r) => r.branchId).map((r) => [String(r.branchId), r]));
  const prevByBranch = new Map(prevRows.filter((r) => r.branchId).map((r) => [String(r.branchId), r]));
  const priorByBranch = new Map(priorRows.filter((r) => r.branchId).map((r) => [String(r.branchId), r]));

  const branchRows: MetricRow[] = allBranches.map((b) => {
    const sv = savedByBranch.get(b.id);
    const pr = prevByBranch.get(b.id);
    const carry = priorByBranch.get(b.id);
    const target =
      sv?.targetNum != null ? n(sv.targetNum) : carry?.targetNum != null ? n(carry.targetNum) : null;
    return {
      sourceType: "branch",
      branchId: b.id,
      name: b.name,
      target,
      value: sv ? n(sv.valueNum) : live.get(b.id) ?? 0,
      prevValue: pr ? n(pr.valueNum) : null,
      liveValue: live.get(b.id) ?? 0,
    };
  });

  const savedExt = savedRows.filter((r) => !r.branchId);
  const prevExtByName = new Map(prevRows.filter((r) => !r.branchId).map((r) => [r.sourceName, r]));
  const extSource = savedExt.length > 0 ? savedExt : priorRows.filter((r) => !r.branchId);
  const externalRows: MetricRow[] = extSource
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((r) => {
      const pr = prevExtByName.get(r.sourceName);
      return {
        sourceType: "external",
        branchId: null,
        name: r.sourceName,
        target: r.targetNum != null ? n(r.targetNum) : null,
        value: savedExt.length > 0 ? n(r.valueNum) : 0,
        prevValue: pr ? n(pr.valueNum) : null,
      };
    });

  return {
    metricKey,
    period,
    prevPeriod,
    asOnLabel: monthEndLabel(period),
    prevAsOnLabel: monthEndLabel(prevPeriod),
    branches: branchRows,
    externals: externalRows,
    saved,
  };
}

export type SaveRow = {
  sourceType: "branch" | "external";
  branchId?: string | null;
  name: string;
  value: number;
  target?: number | null;
};

/** Replace all rows for (metricKey × period) with the supplied set. */
export async function saveMetricStatus(
  tx: Tx,
  tenantId: string,
  metricKey: MetricKey,
  period: string,
  rows: SaveRow[]
): Promise<void> {
  await tx
    .delete(metricSnapshots)
    .where(and(eq(metricSnapshots.metricKey, metricKey), eq(metricSnapshots.period, period)));

  // Dedupe so the partial unique indexes never reject the insert; last wins.
  const seen = new Set<string>();
  const clean = rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.sourceType === "branch" || (r.name && r.name.trim().length > 0))
    .filter(({ r }) => {
      const key =
        r.sourceType === "branch" ? `b:${r.branchId ?? ""}` : `e:${r.name.trim().toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  if (clean.length === 0) return;

  await tx.insert(metricSnapshots).values(
    clean.map(({ r, i }) => ({
      tenantId,
      metricKey,
      period,
      sourceType: r.sourceType,
      branchId: r.sourceType === "branch" ? r.branchId ?? null : null,
      sourceName: r.name.trim(),
      valueNum: String(Number.isFinite(r.value) ? r.value : 0),
      targetNum: r.target != null && Number.isFinite(r.target) ? String(r.target) : null,
      sortOrder: i,
    }))
  );
}
