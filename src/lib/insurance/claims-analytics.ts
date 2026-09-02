/**
 * Insurance Claims analytics — settlement TAT, aging buckets and a per-insurer
 * settlement scorecard. SERVER-ONLY.
 *
 * Aging buckets group OPEN claims by days since intimation (0–30 / 31–60 /
 * 61–90 / 90+). The scorecard summarises each insurer's outcomes: approval
 * rate (settled vs decided) and average turnaround (intimation → settlement).
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { OPEN_CLAIM_STATUSES } from "@/lib/insurance/claim-status";

const n = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

export type AgingBucket = { label: string; count: number; amount: number };
export type InsurerScore = {
  insurer: string;
  total: number;
  settled: number;
  rejected: number;
  approvalRate: number | null;
  avgTatDays: number | null;
  settledAmount: number;
};

const OPEN_LIST = sql.join(
  OPEN_CLAIM_STATUSES.map((s) => sql`${s}`),
  sql`, `
);

/** Counts + claimed-amount sums of OPEN claims bucketed by age since intimation. */
export async function loadAgingBuckets(tx: Tx, tenantId: string): Promise<AgingBucket[]> {
  const res = await tx.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE current_date - intimation_date <= 30) AS c0,
      COALESCE(SUM(claimed_amount) FILTER (WHERE current_date - intimation_date <= 30), 0)::numeric AS a0,
      COUNT(*) FILTER (WHERE current_date - intimation_date BETWEEN 31 AND 60) AS c1,
      COALESCE(SUM(claimed_amount) FILTER (WHERE current_date - intimation_date BETWEEN 31 AND 60), 0)::numeric AS a1,
      COUNT(*) FILTER (WHERE current_date - intimation_date BETWEEN 61 AND 90) AS c2,
      COALESCE(SUM(claimed_amount) FILTER (WHERE current_date - intimation_date BETWEEN 61 AND 90), 0)::numeric AS a2,
      COUNT(*) FILTER (WHERE current_date - intimation_date > 90) AS c3,
      COALESCE(SUM(claimed_amount) FILTER (WHERE current_date - intimation_date > 90), 0)::numeric AS a3
    FROM insurance_claims
    WHERE tenant_id = ${tenantId}::uuid
      AND claim_status IN (${OPEN_LIST})
      AND intimation_date IS NOT NULL
  `);
  const r = (res.rows[0] as any) ?? {};
  return [
    { label: "0–30 days", count: n(r.c0), amount: n(r.a0) },
    { label: "31–60 days", count: n(r.c1), amount: n(r.a1) },
    { label: "61–90 days", count: n(r.c2), amount: n(r.a2) },
    { label: "90+ days", count: n(r.c3), amount: n(r.a3) },
  ];
}

/** Per-insurer settlement scorecard: approval rate + average TAT. */
export async function loadInsurerScorecard(tx: Tx, tenantId: string): Promise<InsurerScore[]> {
  const res = await tx.execute(sql`
    SELECT
      insurer,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE claim_status IN ('settled_fully','settled_partially')) AS settled,
      COUNT(*) FILTER (WHERE claim_status = 'rejected') AS rejected,
      COALESCE(SUM(settled_amount) FILTER (WHERE claim_status IN ('settled_fully','settled_partially')), 0)::numeric AS settled_amount,
      AVG(settlement_date - intimation_date) FILTER (
        WHERE claim_status IN ('settled_fully','settled_partially')
          AND settlement_date IS NOT NULL
          AND intimation_date IS NOT NULL
      ) AS avg_tat
    FROM insurance_claims
    WHERE tenant_id = ${tenantId}::uuid
      AND insurer IS NOT NULL
    GROUP BY insurer
    ORDER BY total DESC
    LIMIT 30
  `);
  return (res.rows as any[]).map((r) => {
    const settled = n(r.settled);
    const rejected = n(r.rejected);
    const decided = settled + rejected;
    return {
      insurer: String(r.insurer),
      total: n(r.total),
      settled,
      rejected,
      approvalRate: decided > 0 ? settled / decided : null,
      avgTatDays: r.avg_tat == null ? null : Math.round(n(r.avg_tat)),
      settledAmount: n(r.settled_amount),
    };
  });
}
