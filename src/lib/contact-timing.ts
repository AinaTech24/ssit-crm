/**
 * Best-Time-to-Contact — infer each client's most responsive window from their
 * own interaction history (Zoho Zia "Best Time to Contact" parity). We look at
 * when contact actually *succeeded* — inbound messages, answered calls, read /
 * replied messages — and surface the modal day-part + weekday so the RM calls
 * when the client tends to pick up. Pure read; needs ≥3 data points.
 */

import { sql } from "drizzle-orm";

type Tx = { execute: (q: any) => Promise<{ rows: any[] }> };

export type BestTime = { label: string; dayPart: "morning" | "afternoon" | "evening"; weekend: boolean; basis: number };

const DAYPART_LABEL = { morning: "mornings", afternoon: "afternoons", evening: "evenings" } as const;

export async function bestContactWindow(tx: Tx, opts: { tenantId: string; investorId: string }): Promise<BestTime | null> {
  const r = await tx.execute(sql`
    SELECT EXTRACT(HOUR FROM ts)::int AS hr, EXTRACT(DOW FROM ts)::int AS dow FROM (
      SELECT a.occurred_at AS ts FROM activities a
        WHERE a.tenant_id = ${opts.tenantId}::uuid AND a.subject_type = 'investor' AND a.subject_id = ${opts.investorId}::uuid
          AND (a.direction = 'inbound' OR (a.kind = 'call' AND a.status = 'answered'))
      UNION ALL
      SELECT c.created_at AS ts FROM communications c
        WHERE c.tenant_id = ${opts.tenantId}::uuid AND c.investor_id = ${opts.investorId}::uuid
          AND (c.direction = 'inbound' OR c.status IN ('read','replied'))
    ) t
    WHERE ts IS NOT NULL
  `);
  const rows = r.rows as Array<{ hr: number; dow: number }>;
  if (rows.length < 3) return null;

  const part = { morning: 0, afternoon: 0, evening: 0 };
  let weekend = 0;
  for (const x of rows) {
    const h = Number(x.hr);
    if (h >= 6 && h < 12) part.morning++;
    else if (h >= 12 && h < 17) part.afternoon++;
    else part.evening++; // evenings + early/late hours fold here
    const d = Number(x.dow);
    if (d === 0 || d === 6) weekend++;
  }
  const dayPart = (Object.entries(part).sort((a, b) => b[1] - a[1])[0][0]) as BestTime["dayPart"];
  const isWeekend = weekend > rows.length / 2;
  return {
    dayPart,
    weekend: isWeekend,
    basis: rows.length,
    label: `${isWeekend ? "Weekend" : "Weekday"} ${DAYPART_LABEL[dayPart]}`,
  };
}
