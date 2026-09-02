/**
 * LTCG tax-harvesting planner for equity mutual funds.
 *
 * India taxes long-term capital gains (units held > 12 months) on equity MFs at
 * 12.5%, but the FIRST ₹1,25,000 of LTCG each financial year is EXEMPT
 * (Budget 2024, FY 2024-25 onward — raised from ₹1,00,000). "Harvesting" =
 * deliberately redeeming long-term units to realise gains up to that exemption
 * (tax-free) and rebuying, which books tax-free profit and steps up the cost
 * basis — shrinking the taxable gain on the eventual real redemption. Done every
 * year it saves up to ₹15,625 of tax per client per year.
 *
 * This planner estimates, per client, the unrealised LONG-TERM gain on their
 * equity holdings and how much can be harvested within this year's exemption.
 *
 * It is an ESTIMATE for planning, not a tax filing: cost basis uses net invested
 * (a close proxy for the remaining lots' cost) rather than strict FIFO lot
 * tracking, and "long-term" is judged from the first purchase date of each
 * holding. The MFD confirms exact figures from the CAS before acting.
 *
 * Pure aggregation over a single SQL sweep — pass the tx from withTenant.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { fifoOpenLots, currentFyStartYear, type TxRow } from "@/lib/tax/realized-gains";

/** Whole days between two YYYY-MM-DD dates. */
function holdingDays(buy: string, sell: string): number {
  return Math.floor((Date.parse(sell) - Date.parse(buy)) / 86_400_000);
}

/** This year's LTCG exemption on equity (₹). */
export const LTCG_EXEMPTION = 125_000;
/** LTCG rate above the exemption (12.5%). */
export const LTCG_RATE = 0.125;

/** Equity-taxed if the category/name looks like equity / ELSS / aggressive hybrid. */
function isEquityTaxed(category?: string | null, name?: string | null): boolean {
  const s = `${category ?? ""} ${name ?? ""}`.toLowerCase();
  if (/debt|liquid|overnight|money.?market|gilt|bond|ultra.?short|low.?duration|banking.?psu|corporate.?bond/.test(s)) {
    return false;
  }
  return /equity|elss|tax.?saver|flexi.?cap|large.?cap|mid.?cap|small.?cap|multi.?cap|focused|value|contra|index|nifty|sensex|aggressive|hybrid|balanced.?advantage/.test(s);
}

export type HarvestHolding = {
  schemeName: string | null;
  schemeCode: string | null;
  ltUnits: number;
  longTermGain: number;
};

export type HarvestRow = {
  investorId: string;
  investorName: string;
  rmId: string | null;
  /** Total unrealised long-term equity gain (₹) — only units held > 12 months. */
  longTermGain: number;
  /** LTCG already realised this FY (eats into the exemption). */
  realizedLtcgThisFy: number;
  /** Exemption still available = max(0, 1,25,000 − realised this FY). */
  remainingExemption: number;
  /** How much can be harvested tax-free this year (min of LT gain + remaining exemption). */
  harvestable: number;
  /** Tax saved by harvesting this year (harvestable × 12.5%). */
  taxSaved: number;
  holdings: HarvestHolding[];
};

export type LossHolding = { schemeName: string | null; schemeCode: string | null; loss: number; term: "lt" | "st" };
export type LossRow = {
  investorId: string;
  investorName: string;
  rmId: string | null;
  ltLoss: number; // long-term unrealised loss (offsets LT gains)
  stLoss: number; // short-term unrealised loss (offsets ST + LT gains)
  totalLoss: number;
  holdings: LossHolding[];
};

export type HarvestScan = { gains: HarvestRow[]; losses: LossRow[]; fyStartYear: number };

export async function scanTaxHarvest(tx: Tx, opts: { limit?: number; rmId?: string } = {}): Promise<HarvestScan> {
  // RM scope: a non-manager viewing their own book passes rmId; managers omit it
  // and sweep the whole firm.
  const rmScope = opts.rmId ? sql` AND i.rm_id = ${opts.rmId}::uuid` : sql``;
  // One sweep of every transaction for active investors, ordered so we can FIFO
  // per (investor, scheme). Redeemed lots fall out of FIFO automatically.
  const res = await tx.execute(sql`
    SELECT t.investor_id, i.name AS investor_name, i.rm_id,
           t.scheme_code, t.scheme_name, t.scheme_category, t.type, t.direction,
           t.units, t.nav, t.amount, t.order_date
    FROM transactions t
    JOIN investors i ON i.id = t.investor_id AND i.status = 'active' AND i.deleted_at IS NULL${rmScope}
    WHERE t.status IN ('processed', 'successful') AND t.order_date IS NOT NULL
    ORDER BY t.investor_id, t.order_date ASC, t.id ASC
  `);
  const navRes = await tx.execute(sql`SELECT scheme_code, nav FROM scheme_nav WHERE scheme_code IS NOT NULL`);
  const navByScheme = new Map<string, number>();
  for (const r of navRes.rows as any[]) if (r.scheme_code != null && r.nav != null) navByScheme.set(String(r.scheme_code), Number(r.nav));

  const fyStartYear = currentFyStartYear();
  const nowStr = new Date().toISOString().slice(0, 10);

  const byInv = new Map<string, { name: string; rmId: string | null; rows: TxRow[]; cat: Map<string, { category: string | null; name: string | null }> }>();
  for (const r of res.rows as any[]) {
    let grp = byInv.get(r.investor_id);
    if (!grp) { grp = { name: r.investor_name, rmId: r.rm_id, rows: [], cat: new Map() }; byInv.set(r.investor_id, grp); }
    grp.rows.push(r as TxRow);
    const sk = r.scheme_code ?? r.scheme_name ?? "unknown";
    if (!grp.cat.has(sk)) grp.cat.set(sk, { category: r.scheme_category, name: r.scheme_name });
  }

  const gains: HarvestRow[] = [];
  const losses: LossRow[] = [];

  for (const [investorId, g] of byInv) {
    const { open, realizedLtcgThisFy } = fifoOpenLots(g.rows, fyStartYear);
    const ltGainBy = new Map<string, { name: string | null; code: string | null; units: number; gain: number }>();
    const lossBy = new Map<string, { name: string | null; code: string | null; loss: number; term: "lt" | "st" }>();
    let ltGain = 0, ltLoss = 0, stLoss = 0;

    for (const lot of open) {
      const sk = lot.schemeCode ?? lot.schemeName ?? "unknown";
      const meta = g.cat.get(sk);
      if (!isEquityTaxed(meta?.category, meta?.name ?? lot.schemeName)) continue; // equity only
      const nav = lot.schemeCode != null ? navByScheme.get(String(lot.schemeCode)) : undefined;
      if (nav == null || !isFinite(nav)) continue; // unpriced — skip
      const gain = (nav - lot.nav) * lot.units;
      const isLt = holdingDays(lot.date, nowStr) > 365;
      if (gain > 0) {
        if (isLt) {
          ltGain += gain;
          const e = ltGainBy.get(sk) ?? { name: lot.schemeName, code: lot.schemeCode, units: 0, gain: 0 };
          e.units += lot.units; e.gain += gain; ltGainBy.set(sk, e);
        }
        // short-term GAINS aren't harvestable tax-free — ignored.
      } else if (gain < 0) {
        if (isLt) ltLoss += -gain; else stLoss += -gain;
        const e = lossBy.get(sk) ?? { name: lot.schemeName, code: lot.schemeCode, loss: 0, term: isLt ? "lt" : "st" };
        e.loss += -gain; lossBy.set(sk, e);
      }
    }

    if (ltGain > 0.5) {
      const remainingExemption = Math.max(0, LTCG_EXEMPTION - Math.max(0, realizedLtcgThisFy));
      const harvestable = Math.min(ltGain, remainingExemption);
      gains.push({
        investorId, investorName: g.name, rmId: g.rmId,
        longTermGain: ltGain,
        realizedLtcgThisFy: Math.max(0, realizedLtcgThisFy),
        remainingExemption,
        harvestable,
        taxSaved: harvestable * LTCG_RATE,
        holdings: [...ltGainBy.values()].map((e) => ({ schemeName: e.name, schemeCode: e.code, ltUnits: e.units, longTermGain: e.gain })).sort((a, b) => b.longTermGain - a.longTermGain),
      });
    }
    if (ltLoss + stLoss > 0.5) {
      losses.push({
        investorId, investorName: g.name, rmId: g.rmId,
        ltLoss, stLoss, totalLoss: ltLoss + stLoss,
        holdings: [...lossBy.values()].map((e) => ({ schemeName: e.name, schemeCode: e.code, loss: e.loss, term: e.term })).sort((a, b) => b.loss - a.loss),
      });
    }
  }

  gains.sort((a, b) => b.harvestable - a.harvestable || b.longTermGain - a.longTermGain);
  losses.sort((a, b) => b.totalLoss - a.totalLoss);
  return { gains: opts.limit ? gains.slice(0, opts.limit) : gains, losses: opts.limit ? losses.slice(0, opts.limit) : losses, fyStartYear };
}
