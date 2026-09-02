/**
 * Signal-based lead scoring — a behavioural layer on top of the deterministic
 * lead score (Zoho scoring-rules parity). Rewards real engagement signals
 * (inbound contact, answered calls, attended meetings, logged touches) with
 * configurable point values, capped per signal so one noisy lead can't run
 * away. Returns the bonus + an explainable breakdown.
 */

import { sql } from "drizzle-orm";

type Tx = { execute: (q: any) => Promise<{ rows: any[] }> };

export type SignalLine = { label: string; count: number; points: number };
export type SignalScore = { total: number; band: "hot" | "warm" | "cold"; lines: SignalLine[] };

/** Per-signal value + max contribution (editable defaults; could move to a rules table later). */
const SIGNALS = {
  inbound: { label: "Reached out to us", per: 15, cap: 45 },
  call_answered: { label: "Answered a call", per: 10, cap: 40 },
  visit: { label: "Met in person", per: 12, cap: 36 },
  meeting: { label: "Attended a meeting", per: 20, cap: 40 },
  touch: { label: "Engaged on WA/SMS/email", per: 3, cap: 18 },
};

export async function leadSignalScore(tx: Tx, opts: { tenantId: string; leadId: string }): Promise<SignalScore> {
  const act = (await tx.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE direction = 'inbound')::int AS inbound,
      COUNT(*) FILTER (WHERE kind = 'call' AND status = 'answered')::int AS call_answered,
      COUNT(*) FILTER (WHERE kind = 'visit')::int AS visit,
      COUNT(*) FILTER (WHERE kind IN ('whatsapp','sms','email'))::int AS touch
    FROM activities
    WHERE tenant_id = ${opts.tenantId}::uuid AND subject_type = 'lead' AND subject_id = ${opts.leadId}::uuid
  `)).rows[0] as any;
  const mtg = Number((await tx.execute(sql`
    SELECT COUNT(*)::int AS c FROM review_meetings
    WHERE tenant_id = ${opts.tenantId}::uuid AND lead_id = ${opts.leadId}::uuid AND status = 'completed'
  `)).rows[0]?.c ?? 0);

  const counts: Record<keyof typeof SIGNALS, number> = {
    inbound: Number(act?.inbound ?? 0),
    call_answered: Number(act?.call_answered ?? 0),
    visit: Number(act?.visit ?? 0),
    meeting: mtg,
    touch: Number(act?.touch ?? 0),
  };

  const lines: SignalLine[] = [];
  let total = 0;
  for (const key of Object.keys(SIGNALS) as Array<keyof typeof SIGNALS>) {
    const c = counts[key];
    if (c <= 0) continue;
    const def = SIGNALS[key];
    const pts = Math.min(def.cap, c * def.per);
    total += pts;
    lines.push({ label: def.label, count: c, points: pts });
  }
  const band: SignalScore["band"] = total >= 50 ? "hot" : total >= 20 ? "warm" : "cold";
  return { total, band, lines };
}
