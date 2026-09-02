/**
 * Back-Office Work report — per branch, rectification work by particular split
 * Online / Offline, with Value + No. SERVER-ONLY.
 *
 * Source: tasks tagged with meta.boParticular / boChannel / boValue (the
 * Back-Office classification). Branch attribution via the assignee's branch.
 */

import { asc, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { branches } from "@/db/schema";

type ParticularDef = { key: string; label: string };
export const BO_PARTICULARS: ParticularDef[] = [
  { key: "purchase_rectified", label: "Purchase Transaction Rectified" },
  { key: "sip_rectified", label: "SIP Transaction Rectified" },
  { key: "nj_redemption", label: "NJ Redemption" },
  { key: "nj_wecare_switch", label: "NJ To WeCare Switch" },
  { key: "pms", label: "PMS" },
];

export type BoCell = { value: number; count: number };
export type BoRow = {
  label: string;
  online: BoCell;
  offline: BoCell;
  total: BoCell;
};
export type BackOfficeWorkReport = {
  period: string;
  branchId: string;
  branchName: string;
  rows: BoRow[];
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

export async function loadBackOfficeWork(tx: Tx, branchId: string, period: string): Promise<BackOfficeWorkReport> {
  const { start, end } = periodRange(period);
  const [branch] = await tx.select({ id: branches.id, name: branches.name }).from(branches).where(sql`id = ${branchId}`);
  const branchName = branch?.name ?? "Branch";

  // Aggregate tagged tasks by particular × channel for this branch (via assignee).
  const res = await tx.execute(sql`
    SELECT t.meta->>'boParticular' AS particular,
           COALESCE(t.meta->>'boChannel','offline') AS channel,
           COUNT(*)::int AS cnt,
           COALESCE(SUM((t.meta->>'boValue')::numeric), 0)::numeric AS val
      FROM tasks t
      JOIN users u ON u.id = t.assignee_id
     WHERE t.meta->>'boParticular' IS NOT NULL
       AND u.branch_id = ${branchId}
       AND t.created_at >= ${start} AND t.created_at < ${end}
     GROUP BY t.meta->>'boParticular', COALESCE(t.meta->>'boChannel','offline')
  `);

  // map[particular][channel] = {value,count}
  const m = new Map<string, { online: BoCell; offline: BoCell }>();
  for (const r of res.rows as Array<{ particular: string; channel: string; cnt: number; val: string }>) {
    const cur = m.get(r.particular) ?? { online: { value: 0, count: 0 }, offline: { value: 0, count: 0 } };
    const cell = r.channel === "online" ? cur.online : cur.offline;
    cell.value += n(r.val);
    cell.count += n(r.cnt);
    m.set(r.particular, cur);
  }

  const rows: BoRow[] = BO_PARTICULARS.map((p) => {
    const cur = m.get(p.key) ?? { online: { value: 0, count: 0 }, offline: { value: 0, count: 0 } };
    return {
      label: p.label,
      online: cur.online,
      offline: cur.offline,
      total: { value: cur.online.value + cur.offline.value, count: cur.online.count + cur.offline.count },
    };
  });

  return { period, branchId, branchName, rows };
}
