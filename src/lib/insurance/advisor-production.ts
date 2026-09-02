/**
 * Insurance advisor-production report — per advisor, FY premium booked split into
 * Personal Lines + Commercial/General Lines, each by category × New/Renewal.
 * SERVER-ONLY.
 *
 * Source: insurance_policies (annual_premium, policy_type, sold_by_user_id,
 * details->>'businessType' for new/renewal), risk-cover/start date in the FY.
 */

import { asc, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { users } from "@/db/schema";

type CatDef = { key: string; label: string; types: string[] };

export const PERSONAL_LINES: CatDef[] = [
  { key: "health", label: "Health", types: ["health", "critical_illness"] },
  { key: "life", label: "Life", types: ["term", "endowment", "money_back", "life_other"] },
  { key: "ulip", label: "ULIP", types: ["ulip"] },
  { key: "pa", label: "Personal Accident", types: ["personal_accident"] },
  { key: "travel", label: "Travel", types: ["travel"] },
];

export const COMMERCIAL_LINES: CatDef[] = [
  { key: "marine", label: "Marine", types: ["marine"] },
  { key: "fire", label: "Fire / Home / Burglary", types: ["home", "fire", "burglary"] },
  { key: "wc", label: "Workmen Comp (WC)", types: ["workmen_comp"] },
  { key: "motor", label: "Motor / Vehicle", types: ["motor"] },
  { key: "gpa", label: "Group PA (GPA)", types: ["group_personal_accident"] },
  { key: "ghi", label: "Group Health (GHI)", types: ["group_health"] },
  { key: "other", label: "Other", types: ["general_other"] },
];

export type ProdRow = { key: string; label: string; newPrem: number; renewalPrem: number };
export type AdvisorProduction = {
  fiscalYear: string;
  advisorId: string;
  advisorName: string;
  personal: ProdRow[];
  commercial: ProdRow[];
};

const n = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

export function currentFiscalYear(): string {
  const d = new Date();
  const y = d.getMonth() + 1 >= 4 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
}
function fyRange(fy: string): { start: string; end: string } {
  const y = parseInt(fy.slice(0, 4), 10);
  return { start: `${y}-04-01`, end: `${y + 1}-04-01` };
}

export async function listAdvisors(tx: Tx): Promise<{ id: string; name: string }[]> {
  return tx
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(sql`('rm' = ANY(${users.roles}) OR 'branch_head' = ANY(${users.roles}) OR 'owner' = ANY(${users.roles}))`)
    .orderBy(asc(users.name));
}

export async function loadAdvisorProduction(
  tx: Tx,
  advisorId: string,
  fiscalYear: string
): Promise<AdvisorProduction> {
  const { start, end } = fyRange(fiscalYear);

  const [adv] = await tx.select({ id: users.id, name: users.name }).from(users).where(sql`id = ${advisorId}`);
  const advisorName = adv?.name ?? "Advisor";

  const res = await tx.execute(sql`
    SELECT policy_type,
      CASE WHEN LOWER(COALESCE(details->>'businessType','new')) IN ('renewal','portability') THEN 'renewal' ELSE 'new' END AS btype,
      COALESCE(SUM(annual_premium), 0)::numeric AS prem
    FROM insurance_policies
    WHERE sold_by_user_id = ${advisorId}
      AND status <> 'cancelled'
      AND COALESCE(risk_cover_start_date, policy_start_date) >= ${start}
      AND COALESCE(risk_cover_start_date, policy_start_date) < ${end}
    GROUP BY policy_type, CASE WHEN LOWER(COALESCE(details->>'businessType','new')) IN ('renewal','portability') THEN 'renewal' ELSE 'new' END
  `);

  // policyType -> { new, renewal }
  const byType = new Map<string, { newPrem: number; renewalPrem: number }>();
  for (const r of res.rows as Array<{ policy_type: string; btype: string; prem: string }>) {
    const t = String(r.policy_type);
    const cur = byType.get(t) ?? { newPrem: 0, renewalPrem: 0 };
    if (r.btype === "renewal") cur.renewalPrem += n(r.prem);
    else cur.newPrem += n(r.prem);
    byType.set(t, cur);
  }

  const build = (defs: CatDef[]): ProdRow[] =>
    defs.map((c) => {
      let newPrem = 0;
      let renewalPrem = 0;
      for (const t of c.types) {
        const v = byType.get(t);
        if (v) {
          newPrem += v.newPrem;
          renewalPrem += v.renewalPrem;
        }
      }
      return { key: c.key, label: c.label, newPrem, renewalPrem };
    });

  return {
    fiscalYear,
    advisorId,
    advisorName,
    personal: build(PERSONAL_LINES),
    commercial: build(COMMERCIAL_LINES),
  };
}
