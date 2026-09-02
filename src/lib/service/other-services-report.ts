/**
 * Back-Office "Other Services" report — counts of service requests per type per
 * branch in the month. SERVER-ONLY.
 *
 * Rows are the operational particulars (IIN, CAN, bank/name/email/mobile change,
 * switch, SWP, nominee, KYC…); columns are branches. Branch attribution is via
 * the client's branch. Source: service_requests.
 */

import { asc, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { branches } from "@/db/schema";

type RowDef = { label: string; types: string[] };

export const OTHER_SERVICE_ROWS: RowDef[] = [
  { label: "No. of IIN", types: ["iin"] },
  { label: "No. of CAN", types: ["can"] },
  { label: "Bank Change", types: ["bank_update"] },
  { label: "Name Change (AMC)", types: ["name_change"] },
  { label: "Email Change", types: ["email_update"] },
  { label: "Mobile Change", types: ["mobile_update"] },
  { label: "Switch", types: ["switch_request", "switch_help"] },
  { label: "SWP", types: ["swp"] },
  { label: "SWP Stop", types: ["swp_stop"] },
  { label: "Nominee Change", types: ["nominee_update"] },
  { label: "Physical KYC", types: ["physical_kyc"] },
  { label: "Video KYC", types: ["video_kyc"] },
  { label: "KYC (other)", types: ["kyc_update"] },
  { label: "Transmission", types: ["transmission_case"] },
  { label: "Folio Correction", types: ["folio_correction"] },
];

export type OtherServicesReport = {
  period: string;
  branches: { id: string; name: string }[];
  // rows[label] -> { [branchId]: count }
  rows: { label: string; counts: number[] }[];
};

function periodRange(period: string): { start: string; end: string } {
  const [y, m] = period.split("-").map(Number);
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const end = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { start, end };
}

export async function loadOtherServicesReport(tx: Tx, period: string): Promise<OtherServicesReport> {
  const { start, end } = periodRange(period);

  const branchList = await tx.select({ id: branches.id, name: branches.name }).from(branches).orderBy(asc(branches.name));

  // count by (type, branch) via the client's branch.
  const res = await tx.execute(sql`
    SELECT sr.type AS type, i.branch_id AS branch_id, COUNT(*)::int AS cnt
      FROM service_requests sr
      LEFT JOIN investors i ON i.id = sr.investor_id
     WHERE sr.created_at >= ${start} AND sr.created_at < ${end}
     GROUP BY sr.type, i.branch_id
  `);

  // map[type][branchId] = count
  const m = new Map<string, Map<string, number>>();
  for (const r of res.rows as Array<{ type: string; branch_id: string | null; cnt: number }>) {
    if (!r.branch_id) continue;
    const byBranch = m.get(r.type) ?? new Map<string, number>();
    byBranch.set(String(r.branch_id), (byBranch.get(String(r.branch_id)) ?? 0) + Number(r.cnt));
    m.set(r.type, byBranch);
  }

  const rows = OTHER_SERVICE_ROWS.map((rd) => ({
    label: rd.label,
    counts: branchList.map((b) =>
      rd.types.reduce((sum, t) => sum + (m.get(t)?.get(b.id) ?? 0), 0)
    ),
  }));

  return { period, branches: branchList, rows };
}
