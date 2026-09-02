/**
 * Redemption-by-Client report — every client's redemptions in the month, grouped
 * Branch → Desk → RM (contact owner) → client, with RM / desk / branch subtotals
 * and a grand total. SERVER-ONLY.
 *
 * Source: redemption lines on business entries (txn_type='redemption'),
 * attributed to the booking RM and that RM's desk/branch.
 */

import { asc, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { branches, desks } from "@/db/schema";

export type RedemptionRow = {
  kind: "client" | "rm_total" | "desk_total" | "branch_total" | "firm_total";
  owner: string | null;
  client: string | null;
  label: string | null;
  amount: number;
};

export type RedemptionReport = {
  period: string;
  asOnLabel: string;
  rows: RedemptionRow[];
  grandTotal: number;
};

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

function monthEndLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${String(last).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

type Leaf = {
  branchId: string | null;
  deskId: string | null;
  rmId: string | null;
  rmName: string | null;
  client: string;
  amount: number;
};

export async function loadRedemptionReport(
  tx: Tx,
  period: string,
  branchFilter?: string | null
): Promise<RedemptionReport> {
  const { start, end } = periodRange(period);

  const branchList = await tx.select({ id: branches.id, name: branches.name }).from(branches).orderBy(asc(branches.name));
  const deskList = await tx.select({ id: desks.id, name: desks.name }).from(desks);
  const branchName = new Map(branchList.map((b) => [b.id, b.name]));
  const deskName = new Map(deskList.map((d) => [d.id, d.name]));

  const res = await tx.execute(sql`
    SELECT u.branch_id AS branch_id, u.desk_id AS desk_id, be.rm_id AS rm_id, u.name AS rm_name,
           be.client_name AS client, COALESCE(SUM(bel.amount), 0)::numeric AS amt
      FROM business_entries be
      LEFT JOIN users u ON u.id = be.rm_id
      JOIN business_entry_lines bel ON bel.entry_id = be.id
     WHERE bel.txn_type = 'redemption'
       AND be.status IN ('confirmed','emailed')
       AND be.business_date >= ${start} AND be.business_date < ${end}
     GROUP BY u.branch_id, u.desk_id, be.rm_id, u.name, be.client_name
     HAVING COALESCE(SUM(bel.amount), 0) > 0
     ORDER BY u.name, be.client_name
  `);

  const leaves: Leaf[] = (res.rows as any[])
    .map((r) => ({
      branchId: r.branch_id ? String(r.branch_id) : null,
      deskId: r.desk_id ? String(r.desk_id) : null,
      rmId: r.rm_id ? String(r.rm_id) : null,
      rmName: r.rm_name ?? "Unassigned",
      client: r.client ?? "—",
      amount: n(r.amt),
    }))
    .filter((l) => !branchFilter || l.branchId === branchFilter);

  // Group: branch → desk → rm → clients.
  const rows: RedemptionRow[] = [];
  let grandTotal = 0;

  const byBranch = groupBy(leaves, (l) => l.branchId ?? "none");
  // order branches by branchList order, unknown last
  const branchOrder = [...branchList.map((b) => b.id), "none"];
  for (const bId of branchOrder) {
    const bLeaves = byBranch.get(bId);
    if (!bLeaves || bLeaves.length === 0) continue;
    let branchSum = 0;

    const byDesk = groupBy(bLeaves, (l) => l.deskId ?? "nodesk");
    const deskKeys = [...byDesk.keys()].sort((a, b) =>
      (deskName.get(a) ?? "zzz").localeCompare(deskName.get(b) ?? "zzz")
    );
    for (const dId of deskKeys) {
      const dLeaves = byDesk.get(dId)!;
      let deskSum = 0;

      const byRm = groupBy(dLeaves, (l) => l.rmId ?? "none");
      const rmKeys = [...byRm.keys()].sort((a, b) => {
        const na = byRm.get(a)![0].rmName ?? "";
        const nb = byRm.get(b)![0].rmName ?? "";
        return na.localeCompare(nb);
      });
      for (const rmId of rmKeys) {
        const clients = byRm.get(rmId)!.sort((a, b) => a.client.localeCompare(b.client));
        const owner = clients[0].rmName ?? "Unassigned";
        let rmSum = 0;
        clients.forEach((c, i) => {
          rmSum += c.amount;
          rows.push({ kind: "client", owner: i === 0 ? owner : null, client: c.client, label: null, amount: c.amount });
        });
        if (clients.length > 1) {
          rows.push({ kind: "rm_total", owner: null, client: null, label: "TOTAL", amount: rmSum });
        }
        deskSum += rmSum;
      }

      const deskLabel = dId === "nodesk" ? `${branchName.get(bId) ?? ""} (No desk)` : `${branchName.get(bId) ?? ""} ${deskName.get(dId) ?? ""}`.trim();
      rows.push({ kind: "desk_total", owner: null, client: null, label: deskLabel, amount: deskSum });
      branchSum += deskSum;
    }

    rows.push({ kind: "branch_total", owner: null, client: null, label: branchName.get(bId) ?? "Unassigned", amount: branchSum });
    grandTotal += branchSum;
  }

  rows.push({ kind: "firm_total", owner: null, client: null, label: "WCFW Total", amount: grandTotal });

  return { period, asOnLabel: monthEndLabel(period), rows, grandTotal };
}

function groupBy<T>(arr: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const item of arr) {
    const k = key(item);
    const a = m.get(k) ?? [];
    a.push(item);
    m.set(k, a);
  }
  return m;
}
