/**
 * Branch + RM-wise business matrix — computes the monthly-meeting tables ("Anand
 * DK SIP", "… Equity Lumpsum", "… Liquid Lumpsum", "… Insurance") live from the
 * Transactions + Insurance modules. SERVER-ONLY (imports the DB).
 *
 * For a branch + month + kind: one row per branch RM (role rm / branch_head),
 * each column summed from that RM's booked business; an "Outside to our" residual
 * = the branch's business not booked by a roster RM; and a TOTAL. Money is in ₹
 * (raw), matching the source figures.
 *
 * Branch attribution: business is RM-centric for the RM rows (an RM's branch is
 * users.branch_id); the "Outside" residual is branch-centric (the client's /
 * policy's branch) so non-RM business still lands somewhere.
 */

import { sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { branches } from "@/db/schema";
import { RM_MATRIX, type RmMatrixKey } from "./rm-matrix-config";

export type MatrixRow = { rmId: string | null; name: string; values: number[] };
export type RmMatrix = {
  kind: RmMatrixKey;
  title: string;
  period: string;
  asOnLabel: string;
  branchId: string;
  branchName: string;
  columns: { key: string; label: string }[];
  hasNet: boolean;
  rows: MatrixRow[];
  outside: MatrixRow;
  total: MatrixRow;
};

const n = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

/** 'YYYY-MM' → { start: 'YYYY-MM-01', end: first day of next month }. */
function periodRange(period: string): { start: string; end: string } {
  const [y, m] = period.split("-").map(Number);
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const end =
    m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { start, end };
}

function monthEndLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${String(last).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

/** Per-(kind,column) sum predicate over business_entry_lines (alias `bel`). */
const BE_COND: Record<string, SQL[]> = {
  sip: [sql`bel.txn_type IN ('sip','sip_topup')`, sql`bel.txn_type = 'sip_stop'`],
  equity_lumpsum: [
    sql`bel.asset_class = 'equity' AND bel.txn_type IN ('lumpsum','additional_purchase')`,
    sql`bel.asset_class = 'equity' AND bel.txn_type = 'redemption'`,
  ],
  liquid_lumpsum: [
    sql`bel.asset_class = 'liquid' AND bel.txn_type IN ('lumpsum','additional_purchase')`,
    sql`bel.asset_class = 'liquid' AND bel.txn_type = 'redemption'`,
  ],
};

/** Insurance category predicates over insurance_policies (alias `p`). */
const INS_COND: SQL[] = [
  sql`p.policy_type IN ('term','ulip','endowment','money_back','life_other')`, // Life
  sql`p.policy_type IN ('health','critical_illness')`, // Health
  sql`p.policy_type IN ('personal_accident','motor','travel','home','general_other')`, // Other
];

const ROSTER = (branchId: string): SQL =>
  sql`branch_id = ${branchId} AND ('rm' = ANY(roles) OR 'branch_head' = ANY(roles))`;

export async function listBranches(tx: Tx): Promise<{ id: string; name: string }[]> {
  return tx.select({ id: branches.id, name: branches.name }).from(branches).orderBy(branches.name);
}

export async function loadRmMatrix(
  tx: Tx,
  kind: RmMatrixKey,
  branchId: string,
  period: string
): Promise<RmMatrix> {
  const meta = RM_MATRIX[kind];
  const { start, end } = periodRange(period);

  const [branch] = await tx
    .select({ id: branches.id, name: branches.name })
    .from(branches)
    .where(sql`id = ${branchId}`);
  const branchName = branch?.name ?? "Branch";

  let rows: MatrixRow[];
  let outside: MatrixRow;

  if (meta.source === "business_entries") {
    const [c0, c1] = BE_COND[kind];

    const rmRes = await tx.execute(sql`
      SELECT u.id AS rm_id, u.name AS rm_name,
        COALESCE(SUM(bel.amount) FILTER (WHERE ${c0}), 0)::numeric AS c0,
        COALESCE(SUM(bel.amount) FILTER (WHERE ${c1}), 0)::numeric AS c1
      FROM users u
      LEFT JOIN business_entries be
        ON be.rm_id = u.id
       AND be.status IN ('confirmed','emailed')
       AND be.business_date >= ${start} AND be.business_date < ${end}
      LEFT JOIN business_entry_lines bel ON bel.entry_id = be.id
      WHERE u.branch_id = ${branchId}
        AND ('rm' = ANY(u.roles) OR 'branch_head' = ANY(u.roles))
      GROUP BY u.id, u.name
      ORDER BY u.name
    `);
    rows = (rmRes.rows as any[]).map((r) => ({
      rmId: String(r.rm_id),
      name: r.rm_name,
      values: [n(r.c0), n(r.c1)],
    }));

    const outRes = await tx.execute(sql`
      SELECT
        COALESCE(SUM(bel.amount) FILTER (WHERE ${c0}), 0)::numeric AS c0,
        COALESCE(SUM(bel.amount) FILTER (WHERE ${c1}), 0)::numeric AS c1
      FROM business_entries be
      JOIN investors i ON i.id = be.investor_id
      LEFT JOIN business_entry_lines bel ON bel.entry_id = be.id
      WHERE be.status IN ('confirmed','emailed')
        AND be.business_date >= ${start} AND be.business_date < ${end}
        AND i.branch_id = ${branchId}
        AND i.deleted_at IS NULL
        AND (be.rm_id IS NULL OR be.rm_id NOT IN (SELECT id FROM users WHERE ${ROSTER(branchId)}))
    `);
    const o = (outRes.rows as any[])[0] ?? {};
    outside = { rmId: null, name: "Outside to our", values: [n(o.c0), n(o.c1)] };
  } else {
    // Insurance — annual premium by category, from insurance_policies.
    const [life, health, other] = INS_COND;
    const dateCol = sql`COALESCE(p.risk_cover_start_date, p.policy_start_date)`;

    const rmRes = await tx.execute(sql`
      SELECT u.id AS rm_id, u.name AS rm_name,
        COALESCE(SUM(p.annual_premium) FILTER (WHERE ${life}), 0)::numeric AS c0,
        COALESCE(SUM(p.annual_premium) FILTER (WHERE ${health}), 0)::numeric AS c1,
        COALESCE(SUM(p.annual_premium) FILTER (WHERE ${other}), 0)::numeric AS c2
      FROM users u
      LEFT JOIN insurance_policies p
        ON p.sold_by_user_id = u.id
       AND p.status <> 'cancelled'
       AND ${dateCol} >= ${start} AND ${dateCol} < ${end}
      WHERE u.branch_id = ${branchId}
        AND ('rm' = ANY(u.roles) OR 'branch_head' = ANY(u.roles))
      GROUP BY u.id, u.name
      ORDER BY u.name
    `);
    rows = (rmRes.rows as any[]).map((r) => ({
      rmId: String(r.rm_id),
      name: r.rm_name,
      values: [n(r.c0), n(r.c1), n(r.c2)],
    }));

    const outRes = await tx.execute(sql`
      SELECT
        COALESCE(SUM(p.annual_premium) FILTER (WHERE ${life}), 0)::numeric AS c0,
        COALESCE(SUM(p.annual_premium) FILTER (WHERE ${health}), 0)::numeric AS c1,
        COALESCE(SUM(p.annual_premium) FILTER (WHERE ${other}), 0)::numeric AS c2
      FROM insurance_policies p
      WHERE p.status <> 'cancelled'
        AND ${dateCol} >= ${start} AND ${dateCol} < ${end}
        AND p.branch_id = ${branchId}
        AND (p.sold_by_user_id IS NULL OR p.sold_by_user_id NOT IN (SELECT id FROM users WHERE ${ROSTER(branchId)}))
    `);
    const o = (outRes.rows as any[])[0] ?? {};
    outside = { rmId: null, name: "Outside to our", values: [n(o.c0), n(o.c1), n(o.c2)] };
  }

  // TOTAL = sum of every RM row + the Outside row, per column.
  const colCount = meta.columns.length;
  const totalValues = Array.from({ length: colCount }, (_, c) =>
    rows.reduce((a, r) => a + (r.values[c] ?? 0), 0) + (outside.values[c] ?? 0)
  );

  return {
    kind,
    title: `${branchName} — ${meta.title}`,
    period,
    asOnLabel: monthEndLabel(period),
    branchId,
    branchName,
    columns: meta.columns,
    hasNet: meta.hasNet,
    rows,
    outside,
    total: { rmId: null, name: "TOTAL", values: totalValues },
  };
}
