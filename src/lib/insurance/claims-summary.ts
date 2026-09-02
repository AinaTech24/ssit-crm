/**
 * Insurance Claims summary — Claim Logged / Settled / Pending / File Not Received,
 * with counts + amounts. SERVER-ONLY.
 *
 * Logged = claims intimated in the period (count + claimed amount).
 * Settled = settled in the period (count + settled amount).
 * Pending = currently in-process (snapshot, count + claimed amount).
 * File Not Received = awaiting the claim file (snapshot, count + claimed amount).
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";

export type ClaimRow = { label: string; count: number; amount: number | null; settled: number | null };
export type ClaimsSummary = { period: string; rows: ClaimRow[] };

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

const PENDING_STATUSES = [
  "claim_intimated",
  "file_received",
  "add_info_awaited",
  "query",
  "query_replied",
  "under_process",
];

export async function loadClaimsSummary(
  tx: Tx,
  period: string,
  branchFilter?: string | null
): Promise<ClaimsSummary> {
  const { start, end } = periodRange(period);
  const branchCond = branchFilter ? sql`AND branch_id = ${branchFilter}` : sql``;
  const pendingList = sql.join(
    PENDING_STATUSES.map((s) => sql`${s}`),
    sql`, `
  );

  const res = await tx.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE intimation_date >= ${start} AND intimation_date < ${end}) AS logged_no,
      COALESCE(SUM(claimed_amount) FILTER (WHERE intimation_date >= ${start} AND intimation_date < ${end}), 0)::numeric AS logged_amt,
      COUNT(*) FILTER (WHERE claim_status IN ('settled_fully','settled_partially') AND settlement_date >= ${start} AND settlement_date < ${end}) AS settled_no,
      COALESCE(SUM(settled_amount) FILTER (WHERE claim_status IN ('settled_fully','settled_partially') AND settlement_date >= ${start} AND settlement_date < ${end}), 0)::numeric AS settled_amt,
      COUNT(*) FILTER (WHERE claim_status IN (${pendingList})) AS pending_no,
      COALESCE(SUM(claimed_amount) FILTER (WHERE claim_status IN (${pendingList})), 0)::numeric AS pending_amt,
      COUNT(*) FILTER (WHERE claim_status IN ('file_awaited','empty')) AS fnr_no,
      COALESCE(SUM(claimed_amount) FILTER (WHERE claim_status IN ('file_awaited','empty')), 0)::numeric AS fnr_amt
    FROM insurance_claims
    WHERE 1=1 ${branchCond}
  `);
  const r = (res.rows[0] as any) ?? {};

  const rows: ClaimRow[] = [
    { label: "Claim Logged", count: n(r.logged_no), amount: n(r.logged_amt), settled: null },
    { label: "Claim Settled", count: n(r.settled_no), amount: null, settled: n(r.settled_amt) },
    { label: "Pending Claim", count: n(r.pending_no), amount: n(r.pending_amt), settled: null },
    { label: "File Not Received", count: n(r.fnr_no), amount: n(r.fnr_amt), settled: null },
  ];

  return { period, rows };
}
