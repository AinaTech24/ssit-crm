/**
 * SIP Rejection, Pending & Repurchase report — per branch, RMs grouped by desk
 * with desk subtotals and a branch total. SERVER-ONLY.
 *
 * Columns: Rejection (value + no.), Add. Purchase (value + no.), Pending (value +
 * no.). Rejection + Pending come from SIP transactions (type='sip',
 * status rejected/pending), attributed via the investor's RM. Add. Purchase comes
 * from business entries (txn_type='additional_purchase'), attributed via the
 * booking RM.
 */

import { and, asc, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { branches, desks, users } from "@/db/schema";

export const SIP_REJ_COLUMNS = [
  "Rejection Value",
  "Rejection No.",
  "Add. Purchase Value",
  "Add. Purchase No.",
  "Pending Value",
  "Pending No.",
];

export type SipRejRow = {
  kind: "rm" | "desk_total" | "branch_total";
  label: string;
  values: number[]; // aligned to SIP_REJ_COLUMNS
  indent: boolean;
};

export type SipRejReport = {
  period: string;
  branchId: string;
  branchName: string;
  columns: string[];
  rows: SipRejRow[];
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

export async function loadSipRejectionReport(
  tx: Tx,
  branchId: string,
  period: string
): Promise<SipRejReport> {
  const { start, end } = periodRange(period);

  const [branch] = await tx.select({ id: branches.id, name: branches.name }).from(branches).where(eq(branches.id, branchId));
  const branchName = branch?.name ?? "Branch";

  // Roster: RMs of this branch (with their desk).
  const roster = await tx
    .select({ id: users.id, name: users.name, deskId: users.deskId })
    .from(users)
    .where(and(eq(users.branchId, branchId), sql`('rm' = ANY(${users.roles}) OR 'branch_head' = ANY(${users.roles}))`))
    .orderBy(asc(users.name));

  const deskList = await tx.select({ id: desks.id, name: desks.name }).from(desks).where(eq(desks.branchId, branchId)).orderBy(asc(desks.name));
  const deskName = new Map(deskList.map((d) => [d.id, d.name]));

  // Rejection + Pending by RM (via investor's RM).
  const rejRes = await tx.execute(sql`
    SELECT i.rm_id AS rm_id,
      COALESCE(SUM(t.amount) FILTER (WHERE t.status='rejected'), 0)::numeric AS rej_val,
      COUNT(*) FILTER (WHERE t.status='rejected') AS rej_no,
      COALESCE(SUM(t.amount) FILTER (WHERE t.status='pending'), 0)::numeric AS pend_val,
      COUNT(*) FILTER (WHERE t.status='pending') AS pend_no
    FROM transactions t
    JOIN investors i ON i.id = t.investor_id
    WHERE t.type = 'sip' AND t.status IN ('rejected','pending')
      AND t.order_date >= ${start} AND t.order_date < ${end}
      AND i.deleted_at IS NULL
    GROUP BY i.rm_id
  `);
  const rejByRm = new Map<string, { rejVal: number; rejNo: number; pendVal: number; pendNo: number }>();
  for (const r of rejRes.rows as any[]) {
    if (r.rm_id) rejByRm.set(String(r.rm_id), { rejVal: n(r.rej_val), rejNo: n(r.rej_no), pendVal: n(r.pend_val), pendNo: n(r.pend_no) });
  }

  // Additional purchase by RM (via booking RM).
  const apRes = await tx.execute(sql`
    SELECT be.rm_id AS rm_id,
      COALESCE(SUM(bel.amount), 0)::numeric AS ap_val,
      COUNT(*) AS ap_no
    FROM business_entries be
    JOIN business_entry_lines bel ON bel.entry_id = be.id
    WHERE bel.txn_type = 'additional_purchase'
      AND be.status IN ('confirmed','emailed')
      AND be.business_date >= ${start} AND be.business_date < ${end}
    GROUP BY be.rm_id
  `);
  const apByRm = new Map<string, { apVal: number; apNo: number }>();
  for (const r of apRes.rows as any[]) {
    if (r.rm_id) apByRm.set(String(r.rm_id), { apVal: n(r.ap_val), apNo: n(r.ap_no) });
  }

  const valuesFor = (rmId: string): number[] => {
    const rej = rejByRm.get(rmId) ?? { rejVal: 0, rejNo: 0, pendVal: 0, pendNo: 0 };
    const ap = apByRm.get(rmId) ?? { apVal: 0, apNo: 0 };
    return [rej.rejVal, rej.rejNo, ap.apVal, ap.apNo, rej.pendVal, rej.pendNo];
  };
  const addInto = (acc: number[], v: number[]) => v.forEach((x, i) => (acc[i] += x));

  // Group roster by desk.
  const byDesk = new Map<string, typeof roster>();
  for (const u of roster) {
    const k = u.deskId ?? "nodesk";
    const a = byDesk.get(k) ?? [];
    a.push(u);
    byDesk.set(k, a);
  }
  const deskKeys = [...byDesk.keys()].sort((a, b) => (deskName.get(a) ?? "zzz").localeCompare(deskName.get(b) ?? "zzz"));

  const rows: SipRejRow[] = [];
  const branchTotal = [0, 0, 0, 0, 0, 0];

  for (const dk of deskKeys) {
    const members = byDesk.get(dk)!;
    const deskTotal = [0, 0, 0, 0, 0, 0];
    for (const u of members) {
      const v = valuesFor(u.id);
      rows.push({ kind: "rm", label: u.name, values: v, indent: true });
      addInto(deskTotal, v);
    }
    const label = dk === "nodesk" ? `${branchName} (No desk)` : `${branchName} ${deskName.get(dk) ?? ""}`.trim();
    rows.push({ kind: "desk_total", label, values: deskTotal, indent: false });
    addInto(branchTotal, deskTotal);
  }

  rows.push({ kind: "branch_total", label: `${branchName} Branch`, values: branchTotal, indent: false });

  return { period, branchId, branchName, columns: SIP_REJ_COLUMNS, rows };
}
