/**
 * Direct-Equity service — the "Equity Team" MIS plus DMAT-account / brokerage /
 * target data ops. SERVER-ONLY.
 *
 * Metrics: Brokerage (₹, from monthly equity_brokerage), New DMAT (count opened
 * per month, from equity_dmat_accounts), Active Clients (count active as of a
 * month-end, derived from opened/closed dates). Targets live in annual_targets.
 */

import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { annualTargets, equityBrokerage, equityDmatAccounts } from "@/db/schema";

const METRICS = {
  brokerage: "equity_brokerage",
  newDmat: "equity_new_dmat",
  activeClients: "equity_active_clients",
} as const;

const n = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

export function currentFiscalYear(): string {
  const d = new Date();
  const y = d.getMonth() + 1 >= 4 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
}
function fyStartPeriod(fy: string): string {
  return `${parseInt(fy.slice(0, 4), 10)}-04`;
}
function prevPeriod(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthRange(period: string): { start: string; end: string } {
  const [y, m] = period.split("-").map(Number);
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const end = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { start, end };
}

export type EquityMetricRow = {
  key: "brokerage" | "newDmat" | "activeClients";
  label: string;
  isMoney: boolean;
  planned: number;
  actualToDate: number;
  thisMonth: number;
  lastMonth: number;
};

export type EquityTeamReport = {
  fiscalYear: string;
  period: string; // "as of" month
  prevPeriod: string;
  rows: EquityMetricRow[];
};

async function firmTarget(tx: Tx, metric: string, fy: string): Promise<number> {
  const [row] = await tx
    .select({ v: annualTargets.targetValue })
    .from(annualTargets)
    .where(and(eq(annualTargets.metricKey, metric), eq(annualTargets.fiscalYear, fy), eq(annualTargets.scopeType, "firm")));
  return row ? n(row.v) : 0;
}

async function brokerageSum(tx: Tx, fromPeriod: string, toPeriod: string): Promise<number> {
  const res = await tx.execute(sql`
    SELECT COALESCE(SUM(amount), 0)::numeric AS s FROM equity_brokerage
     WHERE period >= ${fromPeriod} AND period <= ${toPeriod}
  `);
  return n((res.rows[0] as any)?.s);
}
async function brokerageFor(tx: Tx, period: string): Promise<number> {
  const res = await tx.execute(sql`SELECT COALESCE(SUM(amount),0)::numeric AS s FROM equity_brokerage WHERE period = ${period}`);
  return n((res.rows[0] as any)?.s);
}
async function dmatOpenedCount(tx: Tx, start: string, end: string): Promise<number> {
  const res = await tx.execute(sql`SELECT COUNT(*)::int AS c FROM equity_dmat_accounts WHERE opened_date >= ${start} AND opened_date < ${end}`);
  return n((res.rows[0] as any)?.c);
}
/** Active accounts as of a date (opened on/before, not closed before). */
async function activeAsOf(tx: Tx, asOf: string): Promise<number> {
  const res = await tx.execute(sql`
    SELECT COUNT(*)::int AS c FROM equity_dmat_accounts
     WHERE opened_date <= ${asOf} AND (closed_date IS NULL OR closed_date > ${asOf}) AND status <> 'closed'
  `);
  return n((res.rows[0] as any)?.c);
}

export async function loadEquityTeam(tx: Tx, fy: string, period: string): Promise<EquityTeamReport> {
  const prev = prevPeriod(period);
  const fyStart = fyStartPeriod(fy);
  const thisM = monthRange(period);
  const prevM = monthRange(prev);
  // "Active as of month-end" — use the first day of the next month as the cutoff.
  const asOfThis = thisM.end;
  const asOfPrev = prevM.end;

  const [
    brokPlanned, dmatPlanned, activePlanned,
    brokThis, brokPrev, brokToDate,
    dmatThis, dmatPrev, dmatToDate,
    activeThis, activePrev,
  ] = [
    await firmTarget(tx, METRICS.brokerage, fy),
    await firmTarget(tx, METRICS.newDmat, fy),
    await firmTarget(tx, METRICS.activeClients, fy),
    await brokerageFor(tx, period),
    await brokerageFor(tx, prev),
    await brokerageSum(tx, fyStart, period),
    await dmatOpenedCount(tx, thisM.start, thisM.end),
    await dmatOpenedCount(tx, prevM.start, prevM.end),
    await dmatOpenedCount(tx, `${fy.slice(0, 4)}-04-01`, thisM.end),
    await activeAsOf(tx, asOfThis),
    await activeAsOf(tx, asOfPrev),
  ];

  const rows: EquityMetricRow[] = [
    { key: "brokerage", label: "Brokerage", isMoney: true, planned: brokPlanned, actualToDate: brokToDate, thisMonth: brokThis, lastMonth: brokPrev },
    { key: "newDmat", label: "New DMAT", isMoney: false, planned: dmatPlanned, actualToDate: dmatToDate, thisMonth: dmatThis, lastMonth: dmatPrev },
    { key: "activeClients", label: "No. of Active Clients", isMoney: false, planned: activePlanned, actualToDate: activeThis, thisMonth: activeThis, lastMonth: activePrev },
  ];

  return { fiscalYear: fy, period, prevPeriod: prev, rows };
}

// ---- Data ops ----

export async function setBrokerage(tx: Tx, tenantId: string, period: string, amount: number): Promise<void> {
  const [existing] = await tx.select({ id: equityBrokerage.id }).from(equityBrokerage).where(eq(equityBrokerage.period, period));
  if (existing) await tx.update(equityBrokerage).set({ amount: String(amount), updatedAt: new Date() }).where(eq(equityBrokerage.id, existing.id));
  else await tx.insert(equityBrokerage).values({ tenantId, period, amount: String(amount) });
}

export async function setEquityTarget(tx: Tx, tenantId: string, fy: string, metricKey: string, value: number): Promise<void> {
  const [existing] = await tx
    .select({ id: annualTargets.id })
    .from(annualTargets)
    .where(and(eq(annualTargets.metricKey, metricKey), eq(annualTargets.fiscalYear, fy), eq(annualTargets.scopeType, "firm")));
  if (existing) await tx.update(annualTargets).set({ targetValue: String(value), updatedAt: new Date() }).where(eq(annualTargets.id, existing.id));
  else await tx.insert(annualTargets).values({ tenantId, metricKey, fiscalYear: fy, scopeType: "firm", scopeId: null, targetValue: String(value) });
}

export async function listDmat(tx: Tx) {
  return tx.select().from(equityDmatAccounts).orderBy(desc(equityDmatAccounts.openedDate), asc(equityDmatAccounts.clientName));
}

export async function createDmat(
  tx: Tx,
  tenantId: string,
  input: { clientName: string; dmatNumber?: string | null; broker?: string | null; openedDate: string; status?: string }
): Promise<{ id: string }> {
  const [row] = await tx
    .insert(equityDmatAccounts)
    .values({
      tenantId,
      clientName: input.clientName.trim(),
      dmatNumber: input.dmatNumber?.trim() || null,
      broker: input.broker?.trim() || null,
      openedDate: input.openedDate,
      status: (input.status as any) ?? "active",
    })
    .returning({ id: equityDmatAccounts.id });
  return row;
}

export async function updateDmat(
  tx: Tx,
  id: string,
  patch: { clientName?: string; dmatNumber?: string | null; broker?: string | null; openedDate?: string; closedDate?: string | null; status?: string }
): Promise<void> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.clientName != null) set.clientName = patch.clientName.trim();
  if (patch.dmatNumber !== undefined) set.dmatNumber = patch.dmatNumber?.trim() || null;
  if (patch.broker !== undefined) set.broker = patch.broker?.trim() || null;
  if (patch.openedDate != null) set.openedDate = patch.openedDate;
  if (patch.closedDate !== undefined) set.closedDate = patch.closedDate || null;
  if (patch.status != null) set.status = patch.status;
  await tx.update(equityDmatAccounts).set(set).where(eq(equityDmatAccounts.id, id));
}

export async function deleteDmat(tx: Tx, id: string): Promise<void> {
  await tx.delete(equityDmatAccounts).where(eq(equityDmatAccounts.id, id));
}
