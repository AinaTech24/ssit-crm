/**
 * SIF Business — FY "Target vs Actual %" report with the Branch → Desk roll-up.
 * SERVER-ONLY.
 *
 * Rows: each branch's desks (target editable per desk) → a branch subtotal →
 * branches without desks (target editable per branch) → WCFW (firm) total.
 * Actual = live SIF business booked in the FY (business_entries productType='sif',
 * inflow lines only), attributed by the booking RM's desk/branch. Targets live in
 * annual_targets (metric 'sif').
 */

import { and, asc, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { annualTargets, branches, desks } from "@/db/schema";

const METRIC = "sif";

export type SifRow = {
  kind: "desk" | "branch" | "unassigned" | "branch_total" | "firm_total";
  label: string;
  scopeType: "branch" | "desk" | null;
  scopeId: string | null;
  target: number;
  actual: number;
  editable: boolean;
  indent: boolean;
};

export type SifStatus = {
  fiscalYear: string;
  rows: SifRow[];
};

const n = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

/** Current Indian FY label, e.g. '2026-27' (FY starts in April). */
export function currentFiscalYear(): string {
  const d = new Date();
  const y = d.getMonth() + 1 >= 4 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
}

/** 'YYYY-YY' → { start: 'YYYY-04-01', end: '(YYYY+1)-04-01' }. */
function fyRange(fy: string): { start: string; end: string } {
  const y = parseInt(fy.slice(0, 4), 10);
  return { start: `${y}-04-01`, end: `${y + 1}-04-01` };
}

export async function loadSifStatus(tx: Tx, fiscalYear: string): Promise<SifStatus> {
  const { start, end } = fyRange(fiscalYear);

  const branchList = await tx
    .select({ id: branches.id, name: branches.name })
    .from(branches)
    .orderBy(asc(branches.name));
  const deskList = await tx
    .select({ id: desks.id, branchId: desks.branchId, name: desks.name })
    .from(desks)
    .orderBy(asc(desks.name));
  const targetRows = await tx
    .select()
    .from(annualTargets)
    .where(and(eq(annualTargets.metricKey, METRIC), eq(annualTargets.fiscalYear, fiscalYear)));

  // Live SIF actual by (branch, desk) — attributed via the booking RM.
  const actRes = await tx.execute(sql`
    SELECT u.branch_id AS branch_id, u.desk_id AS desk_id, COALESCE(SUM(bel.amount), 0)::numeric AS amt
      FROM business_entries be
      JOIN users u ON u.id = be.rm_id
      JOIN business_entry_lines bel ON bel.entry_id = be.id
     WHERE be.product_type = 'sif'
       AND be.status IN ('confirmed','emailed')
       AND be.business_date >= ${start} AND be.business_date < ${end}
       AND bel.txn_type NOT IN ('redemption','swp','sip_stop')
     GROUP BY u.branch_id, u.desk_id
  `);

  const actByDesk = new Map<string, number>();
  const actByBranch = new Map<string, number>(); // total per branch (all desks + deskless)
  const actDesklessByBranch = new Map<string, number>();
  for (const r of actRes.rows as Array<{ branch_id: string | null; desk_id: string | null; amt: string }>) {
    const amt = n(r.amt);
    if (r.branch_id) actByBranch.set(r.branch_id, (actByBranch.get(r.branch_id) ?? 0) + amt);
    if (r.desk_id) actByDesk.set(r.desk_id, (actByDesk.get(r.desk_id) ?? 0) + amt);
    else if (r.branch_id) actDesklessByBranch.set(r.branch_id, (actDesklessByBranch.get(r.branch_id) ?? 0) + amt);
  }

  const tgtByDesk = new Map<string, number>();
  const tgtByBranch = new Map<string, number>();
  for (const t of targetRows) {
    if (t.scopeType === "desk" && t.scopeId) tgtByDesk.set(t.scopeId, n(t.targetValue));
    if (t.scopeType === "branch" && t.scopeId) tgtByBranch.set(t.scopeId, n(t.targetValue));
  }

  const desksByBranch = new Map<string, { id: string; name: string }[]>();
  for (const d of deskList) {
    const arr = desksByBranch.get(d.branchId) ?? [];
    arr.push({ id: d.id, name: d.name });
    desksByBranch.set(d.branchId, arr);
  }

  const rows: SifRow[] = [];
  let firmTarget = 0;
  let firmActual = 0;

  for (const b of branchList) {
    const bDesks = desksByBranch.get(b.id) ?? [];
    if (bDesks.length > 0) {
      let subTarget = 0;
      let subActual = 0;
      for (const d of bDesks) {
        const target = tgtByDesk.get(d.id) ?? 0;
        const actual = actByDesk.get(d.id) ?? 0;
        subTarget += target;
        subActual += actual;
        rows.push({
          kind: "desk",
          label: `${b.name} ${d.name}`,
          scopeType: "desk",
          scopeId: d.id,
          target,
          actual,
          editable: true,
          indent: true,
        });
      }
      // Business booked by RMs in this branch with no desk assigned.
      const deskless = actDesklessByBranch.get(b.id) ?? 0;
      if (deskless > 0) {
        subActual += deskless;
        rows.push({
          kind: "unassigned",
          label: `${b.name} (No desk)`,
          scopeType: null,
          scopeId: null,
          target: 0,
          actual: deskless,
          editable: false,
          indent: true,
        });
      }
      rows.push({
        kind: "branch_total",
        label: `Total ${b.name}`,
        scopeType: null,
        scopeId: null,
        target: subTarget,
        actual: subActual,
        editable: false,
        indent: false,
      });
      firmTarget += subTarget;
      firmActual += subActual;
    } else {
      const target = tgtByBranch.get(b.id) ?? 0;
      const actual = actByBranch.get(b.id) ?? 0;
      rows.push({
        kind: "branch",
        label: b.name,
        scopeType: "branch",
        scopeId: b.id,
        target,
        actual,
        editable: true,
        indent: false,
      });
      firmTarget += target;
      firmActual += actual;
    }
  }

  rows.push({
    kind: "firm_total",
    label: "WCFW Total",
    scopeType: null,
    scopeId: null,
    target: firmTarget,
    actual: firmActual,
    editable: false,
    indent: false,
  });

  return { fiscalYear, rows };
}

export type SifTargetInput = { scopeType: "branch" | "desk"; scopeId: string; target: number };

export async function saveSifTargets(
  tx: Tx,
  tenantId: string,
  fiscalYear: string,
  targets: SifTargetInput[]
): Promise<void> {
  for (const t of targets) {
    if (!t.scopeId) continue;
    const value = String(Number.isFinite(t.target) ? t.target : 0);
    // Upsert on (tenant, metric, fy, scopeType, scopeId).
    const existing = await tx
      .select({ id: annualTargets.id })
      .from(annualTargets)
      .where(
        and(
          eq(annualTargets.metricKey, METRIC),
          eq(annualTargets.fiscalYear, fiscalYear),
          eq(annualTargets.scopeType, t.scopeType),
          eq(annualTargets.scopeId, t.scopeId)
        )
      );
    if (existing[0]) {
      await tx
        .update(annualTargets)
        .set({ targetValue: value, updatedAt: new Date() })
        .where(eq(annualTargets.id, existing[0].id));
    } else {
      await tx.insert(annualTargets).values({
        tenantId,
        metricKey: METRIC,
        fiscalYear,
        scopeType: t.scopeType,
        scopeId: t.scopeId,
        targetValue: value,
      });
    }
  }
}
