/**
 * SIP Health pack + EFFORTS snapshot (Finowise MIS ideas). SERVER-ONLY.
 *
 * SIP Health (firm-level, for a month):
 *   - Live SIP (₹ + count) from investors.active_sip_amount
 *   - Net SIP = Fresh − Stopped (fresh = new SIP business this month; stopped =
 *     sip_stop entries this month), from business entries
 *   - SIP Maturing this month (count + ₹) from sips.end_date
 *   - SIP Bounced/Rejected this month (count + ₹) from SIP transactions
 *
 * EFFORTS snapshot (actuals this month): new leads + review meetings/tasks done.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";

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

export type SipHealth = {
  period: string;
  liveSip: { amount: number; count: number };
  fresh: { amount: number; count: number };
  /** Fresh SIP split: new-to-firm clients vs existing clients (₹). */
  freshNew: number;
  freshExisting: number;
  stopped: { amount: number; count: number };
  netSip: number;
  maturing: { amount: number; count: number };
  bounced: { amount: number; count: number };
  efforts: { newLeads: number; tasksCompleted: number; reviewsDone: number };
};

async function one(tx: Tx, q: ReturnType<typeof sql>): Promise<any> {
  const res = await tx.execute(q);
  return (res.rows[0] as any) ?? {};
}

export async function loadSipHealth(tx: Tx, period: string): Promise<SipHealth> {
  const { start, end } = periodRange(period);

  const live = await one(tx, sql`
    SELECT COALESCE(SUM(active_sip_amount),0)::numeric AS amt,
           COUNT(*) FILTER (WHERE active_sip_amount > 0)::int AS cnt
      FROM investors
     WHERE deleted_at IS NULL
  `);

  const fresh = await one(tx, sql`
    SELECT COALESCE(SUM(bel.amount),0)::numeric AS amt, COUNT(*)::int AS cnt
      FROM business_entries be JOIN business_entry_lines bel ON bel.entry_id = be.id
     WHERE bel.txn_type IN ('sip','sip_topup') AND be.status IN ('confirmed','emailed')
       AND be.business_date >= ${start} AND be.business_date < ${end}
  `);

  // Fresh SIP split: new-to-firm (no prior SIP business) vs existing client.
  const freshSplit = await one(tx, sql`
    SELECT
      COALESCE(SUM(bel.amount) FILTER (WHERE NOT EXISTS (
        SELECT 1 FROM business_entries be2 JOIN business_entry_lines bel2 ON bel2.entry_id = be2.id
         WHERE be2.investor_id = be.investor_id AND bel2.txn_type IN ('sip','sip_topup') AND be2.business_date < ${start}
      )), 0)::numeric AS new_amt,
      COALESCE(SUM(bel.amount) FILTER (WHERE EXISTS (
        SELECT 1 FROM business_entries be2 JOIN business_entry_lines bel2 ON bel2.entry_id = be2.id
         WHERE be2.investor_id = be.investor_id AND bel2.txn_type IN ('sip','sip_topup') AND be2.business_date < ${start}
      )), 0)::numeric AS existing_amt
      FROM business_entries be JOIN business_entry_lines bel ON bel.entry_id = be.id
     WHERE bel.txn_type IN ('sip','sip_topup') AND be.status IN ('confirmed','emailed')
       AND be.business_date >= ${start} AND be.business_date < ${end}
  `);

  const stopped = await one(tx, sql`
    SELECT COALESCE(SUM(bel.amount),0)::numeric AS amt, COUNT(*)::int AS cnt
      FROM business_entries be JOIN business_entry_lines bel ON bel.entry_id = be.id
     WHERE bel.txn_type = 'sip_stop' AND be.status IN ('confirmed','emailed')
       AND be.business_date >= ${start} AND be.business_date < ${end}
  `);

  const maturing = await one(tx, sql`
    SELECT COALESCE(SUM(amount),0)::numeric AS amt, COUNT(*)::int AS cnt
      FROM sips
     WHERE end_date >= ${start} AND end_date < ${end}
  `);

  const bounced = await one(tx, sql`
    SELECT COALESCE(SUM(amount),0)::numeric AS amt, COUNT(*)::int AS cnt
      FROM transactions
     WHERE type = 'sip' AND status = 'rejected'
       AND order_date >= ${start} AND order_date < ${end}
  `);

  // EFFORTS (actuals). Wrapped so a missing optional table never breaks the report.
  let newLeads = 0;
  let tasksCompleted = 0;
  let reviewsDone = 0;
  try {
    const l = await one(tx, sql`SELECT COUNT(*)::int AS c FROM leads WHERE created_at >= ${start} AND created_at < ${end}`);
    newLeads = n(l.c);
  } catch {
    /* leads table optional */
  }
  try {
    const t = await one(tx, sql`
      SELECT COUNT(*)::int AS c,
             COUNT(*) FILTER (WHERE type IN ('review_meeting','review'))::int AS r
        FROM tasks WHERE status = 'completed' AND completed_at >= ${start} AND completed_at < ${end}`);
    tasksCompleted = n(t.c);
    reviewsDone = n(t.r);
  } catch {
    /* tasks optional */
  }

  return {
    period,
    liveSip: { amount: n(live.amt), count: n(live.cnt) },
    fresh: { amount: n(fresh.amt), count: n(fresh.cnt) },
    freshNew: n(freshSplit.new_amt),
    freshExisting: n(freshSplit.existing_amt),
    stopped: { amount: n(stopped.amt), count: n(stopped.cnt) },
    netSip: n(fresh.amt) - n(stopped.amt),
    maturing: { amount: n(maturing.amt), count: n(maturing.cnt) },
    bounced: { amount: n(bounced.amt), count: n(bounced.cnt) },
    efforts: { newLeads, tasksCompleted, reviewsDone },
  };
}
