/**
 * SEBI-format monthly complaint disclosure.
 *
 * Computes the standard regulatory statement for a calendar month:
 *   pending at start · received · resolved · pending at end
 * plus a received-this-month breakdown by SEBI category and by source.
 *
 * Shared by the disclosure page and the CSV export route so both agree.
 * `tx` is a tenant-scoped transaction (withTenant); queries also filter
 * tenant_id explicitly for safety.
 */

import { sql } from "drizzle-orm";

const CATEGORY_LABEL: Record<string, string> = {
  service: "Service / TAT", mis_selling: "Mis-selling", transaction: "Transaction / order",
  fee: "Fee / commission", kyc: "KYC / documents", communication: "Communication", other: "Other",
};
const SOURCE_LABEL: Record<string, string> = {
  direct: "Direct", scores: "SCORES", amfi: "AMFI", amc: "AMC", email: "Email", phone: "Phone", walk_in: "Walk-in", other: "Other",
};

export type Disclosure = {
  month: string; // YYYY-MM
  label: string; // "May 2026"
  prevMonth: string;
  nextMonth: string;
  pendingStart: number;
  received: number;
  resolved: number;
  pendingEnd: number;
  byCategory: Array<{ key: string; label: string; count: number }>;
  bySource: Array<{ key: string; label: string; count: number }>;
};

/** Normalise a YYYY-MM string (defaults to a provided fallback). */
export function normalizeMonth(input: string | undefined, fallback: string): string {
  return input && /^\d{4}-\d{2}$/.test(input) ? input : fallback;
}

function shift(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export async function computeDisclosure(
  tx: { execute: (q: any) => Promise<{ rows: any[] }> },
  tenantId: string,
  month: string
): Promise<Disclosure> {
  const [y, m] = month.split("-").map(Number);
  const ms = new Date(y, m - 1, 1).toISOString();
  const me = new Date(y, m, 1).toISOString();

  const totals = (await tx.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE created_at < ${ms} AND (resolved_at IS NULL OR resolved_at >= ${ms}))::int AS pending_start,
      COUNT(*) FILTER (WHERE created_at >= ${ms} AND created_at < ${me})::int AS received,
      COUNT(*) FILTER (WHERE status IN ('resolved','closed') AND resolved_at >= ${ms} AND resolved_at < ${me})::int AS resolved,
      COUNT(*) FILTER (WHERE created_at < ${me} AND (resolved_at IS NULL OR resolved_at >= ${me}))::int AS pending_end
    FROM service_requests
    WHERE tenant_id = ${tenantId}::uuid AND type = 'complaint'
  `)).rows[0] as any;

  const cat = (await tx.execute(sql`
    SELECT COALESCE(sebi_category, 'other') AS k, COUNT(*)::int AS c
    FROM service_requests
    WHERE tenant_id = ${tenantId}::uuid AND type = 'complaint'
      AND created_at >= ${ms} AND created_at < ${me}
    GROUP BY 1 ORDER BY c DESC
  `)).rows as Array<{ k: string; c: number }>;

  const src = (await tx.execute(sql`
    SELECT COALESCE(complaint_source, 'direct') AS k, COUNT(*)::int AS c
    FROM service_requests
    WHERE tenant_id = ${tenantId}::uuid AND type = 'complaint'
      AND created_at >= ${ms} AND created_at < ${me}
    GROUP BY 1 ORDER BY c DESC
  `)).rows as Array<{ k: string; c: number }>;

  return {
    month,
    label: new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" }),
    prevMonth: shift(month, -1),
    nextMonth: shift(month, 1),
    pendingStart: Number(totals.pending_start),
    received: Number(totals.received),
    resolved: Number(totals.resolved),
    pendingEnd: Number(totals.pending_end),
    byCategory: cat.map((r) => ({ key: r.k, label: CATEGORY_LABEL[r.k] ?? r.k, count: Number(r.c) })),
    bySource: src.map((r) => ({ key: r.k, label: SOURCE_LABEL[r.k] ?? r.k, count: Number(r.c) })),
  };
}
