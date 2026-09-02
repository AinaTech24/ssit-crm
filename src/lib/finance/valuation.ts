/**
 * Portfolio valuation — turns raw transactions + live NAV into the numbers an
 * MFD and their client actually care about: current market value, net invested,
 * absolute gain, and XIRR (money-weighted annualised return).
 *
 * How it works:
 *   1. Pull every COMPLETED transaction for the investor, left-joined to the
 *      latest NAV (scheme_nav, keyed by AMFI scheme code).
 *   2. Net units per scheme = inflow units − outflow units; current value =
 *      net units × latest NAV. Schemes with no NAV match are flagged
 *      `priced:false` and excluded from value/XIRR (so a missing code never
 *      silently understates returns — the UI shows the coverage gap instead).
 *   3. Cashflows for XIRR: each buy is money out (−amount), each redemption /
 *      dividend payout is money in (+amount); the current market value is a
 *      final inflow dated today.
 *
 * Tenant scoping is the caller's responsibility — pass the `tx` from inside a
 * withTenant() block so RLS already scopes rows to the tenant.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { xirr, absoluteReturn, type CashFlow } from "./xirr";

export type SchemeHolding = {
  schemeCode: string | null;
  schemeName: string | null;
  amcName: string | null;
  /** Folio the holding sits in. If a scheme spans more than one folio we keep
   *  the first and expose the rest via `folioNumbers`. */
  folioNumber: string | null;
  folioNumbers: string[];
  netUnits: number;
  investedNet: number;
  latestNav: number | null;
  navDate: string | null;
  currentValue: number | null;
  gain: number | null;
  /** Money-weighted return for THIS holding (priced holdings only). */
  xirr: number | null;
  /** How the holding was built up: "sip", "lumpsum", or "mixed" (both). */
  kind: "sip" | "lumpsum" | "mixed" | null;
  /** true when a live NAV was found for this scheme. */
  priced: boolean;
  // ── Transaction-derived (null when the holding came from a folio/holdings
  //    snapshot with no transaction history). ──────────────────────────────
  /** First purchase date for this scheme (ISO). */
  startDate: string | null;
  /** Units-weighted average holding period, in days. */
  avgDays: number | null;
  /** Gain already booked on redeemed units (average-cost method, ₹). */
  realisedGain: number | null;
  /** Dividend payouts received on this scheme (₹). */
  dividend: number | null;
  /** true when this holding has any transaction coverage (drives cost/gain/XIRR columns). */
  hasTxns: boolean;
};

/** Whole days between two dates (>= 0). */
function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 86_400_000));
}

export type InvestorValuation = {
  /** Market value of all PRICED holdings (units × latest NAV). */
  currentValue: number;
  /** Net invested across ALL holdings (priced + unpriced). */
  investedNet: number;
  /** Net invested in PRICED holdings only — the basis for gain/return so a
   *  scheme we couldn't price never distorts the percentage. */
  pricedInvested: number;
  /** Net invested in schemes we couldn't price (coverage gap, ₹). */
  unpricedInvested: number;
  /** currentValue − pricedInvested. */
  gain: number;
  /** decimal, e.g. 0.18 = +18% absolute (over priced holdings) */
  absoluteReturn: number | null;
  /** decimal, e.g. 0.142 = 14.2% p.a. (priced holdings only) */
  xirr: number | null;
  asOf: string | null; // latest NAV date seen across holdings
  holdings: SchemeHolding[];
  /** schemes (with units) that had NO live NAV — valuation coverage gap. */
  unpricedSchemes: number;
};

type TxRow = {
  scheme_code: string | null;
  scheme_name: string | null;
  amc_name: string | null;
  folio_number: string | null;
  direction: string | null;
  type: string | null;
  amount: string | null;
  units: string | null;
  order_date: string | null;
  latest_nav: string | null;
  latest_nav_date: string | null;
};

const COMPLETED = ["processed", "successful"];

/**
 * Value one investor's whole book. Returns zeroed totals (not null) when the
 * investor has no completed transactions, so callers can render confidently.
 */
export async function valueInvestor(
  tx: Tx,
  investorId: string
): Promise<InvestorValuation> {
  const res = await tx.execute(sql`
    SELECT t.scheme_code, t.scheme_name, t.amc_name, t.folio_number,
           t.direction, t.type, t.amount, t.units, t.order_date,
           n.nav AS latest_nav, n.nav_date AS latest_nav_date
    FROM transactions t
    LEFT JOIN scheme_nav n ON n.scheme_code = t.scheme_code
    WHERE t.investor_id = ${investorId}
      AND t.status IN ('processed', 'successful')
      AND t.order_date IS NOT NULL
    ORDER BY t.order_date ASC
  `);
  const rows = res.rows as unknown as TxRow[];

  // Per-scheme dated cashflows (for per-holding XIRR) and inflow-type tracking
  // (for the SIP / Lumpsum label), keyed the same way as the holding map.
  const flowsByKey = new Map<string, CashFlow[]>();
  const typesByKey = new Map<string, { sip: boolean; lumpsum: boolean }>();

  // Pass 1 — aggregate per scheme, and stash each transaction's cashflow
  // candidate tagged with its scheme key (so XIRR can later include only the
  // cashflows of schemes we can actually price).
  const bySchemeKey = new Map<string, SchemeHolding>();
  const flowCandidates: Array<{ key: string; date: Date; amount: number }> = [];
  let latestNavDate: string | null = null;

  // Running average-cost lot tracker per scheme (for realised gain), and a
  // units-weighted holding-age accumulator (for avg days). Rows are ordered by
  // order_date ASC, so the running avg cost is correct at each redemption.
  const costTrackByKey = new Map<string, { boughtUnits: number; boughtCost: number }>();
  const ageByKey = new Map<string, { unitsSum: number; dayUnitsSum: number }>();
  const now = new Date();

  for (const r of rows) {
    const key = r.scheme_code ?? r.scheme_name ?? "unknown";
    const amount = r.amount != null ? Number(r.amount) : 0;
    const units = r.units != null ? Number(r.units) : 0;
    const isInflow = r.direction === "inflow"; // money/units INTO the holding (buy)
    const isDividend = !isInflow && !!r.type && /dividend/i.test(r.type); // payout, not a unit redemption

    if (r.order_date && isFinite(amount) && amount !== 0) {
      // buy = money out (−), sell/payout = money in (+).
      const flow = { date: new Date(r.order_date), amount: isInflow ? -amount : amount };
      flowCandidates.push({ key, ...flow });
      const existing = flowsByKey.get(key);
      if (existing) existing.push(flow);
      else flowsByKey.set(key, [flow]);
    }

    // Track how each holding was funded (inflows only): SIP vs lumpsum.
    if (isInflow) {
      const t = typesByKey.get(key) ?? { sip: false, lumpsum: false };
      if (r.type === "sip") t.sip = true;
      else t.lumpsum = true; // lumpsum / switch / stp inflows all count as lumpsum
      typesByKey.set(key, t);
    }

    let h = bySchemeKey.get(key);
    if (!h) {
      const latestNav = r.latest_nav != null ? Number(r.latest_nav) : null;
      h = {
        schemeCode: r.scheme_code,
        schemeName: r.scheme_name,
        amcName: r.amc_name,
        folioNumber: r.folio_number ?? null,
        folioNumbers: [],
        netUnits: 0,
        investedNet: 0,
        latestNav: latestNav != null && isFinite(latestNav) ? latestNav : null,
        navDate: r.latest_nav_date ?? null,
        currentValue: null,
        gain: null,
        xirr: null,
        kind: null,
        priced: false,
        startDate: null,
        avgDays: null,
        realisedGain: 0,
        dividend: 0,
        hasTxns: true,
      };
      bySchemeKey.set(key, h);
    }
    if (r.folio_number && !h.folioNumbers.includes(r.folio_number)) {
      h.folioNumbers.push(r.folio_number);
      if (!h.folioNumber) h.folioNumber = r.folio_number;
    }

    // First-purchase date (rows are ASC, so the first inflow we see is earliest).
    if (isInflow && r.order_date && !h.startDate) h.startDate = r.order_date;

    if (isDividend) {
      // Dividend payout — money to the investor, no unit movement.
      h.dividend = (h.dividend ?? 0) + Math.abs(amount);
    } else if (isInflow) {
      // Buy — add to the average-cost lot + units-weighted age accumulator.
      const ct = costTrackByKey.get(key) ?? { boughtUnits: 0, boughtCost: 0 };
      ct.boughtUnits += units;
      ct.boughtCost += amount;
      costTrackByKey.set(key, ct);
      if (r.order_date && units > 0) {
        const age = ageByKey.get(key) ?? { unitsSum: 0, dayUnitsSum: 0 };
        age.unitsSum += units;
        age.dayUnitsSum += units * daysBetween(new Date(r.order_date), now);
        ageByKey.set(key, age);
      }
    } else if (units > 0) {
      // Redemption / switch-out — book realised gain at the running average cost.
      const ct = costTrackByKey.get(key);
      if (ct && ct.boughtUnits > 0) {
        const avgCost = ct.boughtCost / ct.boughtUnits;
        const redeemed = Math.min(units, ct.boughtUnits);
        h.realisedGain = (h.realisedGain ?? 0) + (amount - avgCost * redeemed);
        ct.boughtUnits -= redeemed;
        ct.boughtCost -= avgCost * redeemed;
      }
    }

    h.netUnits += isInflow ? units : -units;
    h.investedNet += isInflow ? amount : -amount;
    if (r.latest_nav_date && (!latestNavDate || r.latest_nav_date > latestNavDate)) {
      latestNavDate = r.latest_nav_date;
    }
  }

  // Pass 2 — finalise per-scheme value + split totals into priced vs unpriced.
  let currentValue = 0;
  let investedNet = 0;
  let pricedInvested = 0;
  let unpricedInvested = 0;
  let unpricedSchemes = 0;
  const pricedKeys = new Set<string>();
  const holdings: SchemeHolding[] = [];

  for (const [key, h] of bySchemeKey.entries()) {
    if (Math.abs(h.netUnits) < 0.0005) h.netUnits = 0; // dust → fully redeemed
    investedNet += h.investedNet;

    // SIP / Lumpsum / Mixed label from the inflow types we saw.
    const t = typesByKey.get(key);
    h.kind = t ? (t.sip && t.lumpsum ? "mixed" : t.sip ? "sip" : "lumpsum") : null;

    // Units-weighted average holding period.
    const age = ageByKey.get(key);
    h.avgDays = age && age.unitsSum > 0 ? age.dayUnitsSum / age.unitsSum : null;

    if (h.latestNav != null && h.netUnits > 0) {
      h.priced = true;
      h.currentValue = h.netUnits * h.latestNav;
      h.gain = h.currentValue - h.investedNet;
      currentValue += h.currentValue;
      pricedInvested += h.investedNet;
      pricedKeys.add(key);

      // Per-holding XIRR: this scheme's dated cashflows + today's market value.
      const flows = [...(flowsByKey.get(key) ?? []), { date: new Date(), amount: h.currentValue }];
      h.xirr = xirr(flows);
    } else if (h.netUnits > 0) {
      unpricedSchemes++;
      unpricedInvested += h.investedNet;
    }
    holdings.push(h);
  }

  // Market value from PRICED TRANSACTION holdings only — the basis for XIRR
  // (folio-import holdings added below have no cashflow history, so including
  // their value in XIRR would fabricate a return from money that never flowed).
  const txnPricedValue = currentValue;

  // ── Pass 3 — holdings imported via the RTA folio-master / holdings feed ──────
  // `folios.schemes` carries units/NAV/value straight from the registrar. Surface
  // any scheme with NO transaction coverage so imported holdings show up on the
  // profile (and roll into AUM) even when a firm has only uploaded the folio
  // master, not the transaction feed. Cost basis is unknown, so invested is set
  // equal to current value (gain 0) — these never invent a gain — and they're
  // kept out of XIRR (above).
  const txnKeys = new Set(bySchemeKey.keys());
  const folioRes = await tx.execute(sql`
    SELECT f.folio_number, f.amc_name, sc AS scheme
    FROM folios f, LATERAL jsonb_array_elements(COALESCE(f.schemes, '[]'::jsonb)) AS sc
    WHERE f.investor_id = ${investorId}
  `);
  const folioByKey = new Map<string, SchemeHolding>();
  for (const fr of folioRes.rows as any[]) {
    const sc = (fr.scheme ?? {}) as any;
    const schemeCode = sc.schemeCode ?? null;
    const schemeName = sc.schemeName ?? null;
    const key = (schemeCode ?? schemeName) as string | null;
    if (!key || txnKeys.has(key)) continue; // covered by a transaction → no double-count
    const units = Number(sc.units ?? 0) || 0;
    const nav = sc.nav != null && isFinite(Number(sc.nav)) ? Number(sc.nav) : null;
    let value = sc.value != null && isFinite(Number(sc.value)) ? Number(sc.value) : null;
    if (value == null && nav != null && units > 0) value = units * nav;
    if (!((value ?? 0) > 0) && !(units > 0)) continue; // nothing to show
    let h = folioByKey.get(key);
    if (!h) {
      h = {
        schemeCode, schemeName, amcName: fr.amc_name ?? null,
        folioNumber: fr.folio_number ?? null, folioNumbers: [],
        netUnits: 0, investedNet: 0, latestNav: nav, navDate: null,
        currentValue: 0, gain: null, xirr: null, kind: null, priced: false,
        startDate: null, avgDays: null, realisedGain: null, dividend: null, hasTxns: false,
      };
      folioByKey.set(key, h);
    }
    h.netUnits += units;
    if (value != null) h.currentValue = (h.currentValue ?? 0) + value;
    if (fr.folio_number && !h.folioNumbers.includes(fr.folio_number)) {
      h.folioNumbers.push(fr.folio_number);
      if (!h.folioNumber) h.folioNumber = fr.folio_number;
    }
  }
  for (const h of folioByKey.values()) {
    const cv = h.currentValue ?? 0;
    if (cv > 0) {
      h.priced = true;
      h.investedNet = cv;   // cost unknown → invested = current value (gain 0)
      currentValue += cv;
      investedNet += cv;
      pricedInvested += cv;
    }
    holdings.push(h);
  }

  // XIRR over PRICED holdings only: their dated cashflows + today's market value
  // (transaction-priced value only — folio-import holdings have no cashflows).
  const cashflows: CashFlow[] = flowCandidates
    .filter((f) => pricedKeys.has(f.key))
    .map((f) => ({ date: f.date, amount: f.amount }));
  if (txnPricedValue > 0) cashflows.push({ date: new Date(), amount: txnPricedValue });

  const irr = xirr(cashflows);
  const abs = absoluteReturn(pricedInvested, currentValue);

  return {
    currentValue,
    investedNet,
    pricedInvested,
    unpricedInvested,
    gain: currentValue - pricedInvested,
    absoluteReturn: abs,
    xirr: irr,
    asOf: latestNavDate,
    holdings: holdings.sort((a, b) => (b.currentValue ?? 0) - (a.currentValue ?? 0)),
    unpricedSchemes,
  };
}

/**
 * Short-TTL in-memory cache over valueInvestor. NAV moves once a day, yet the
 * computation (full transaction scan + Newton-Raphson XIRR) reran on EVERY
 * call — including every anonymous open of a shared public portfolio link. This
 * caches by investorId (globally-unique UUID, so no cross-tenant key collision)
 * for VALUATION_CACHE_TTL_MS (default 10 min), collapsing repeat hits to one
 * computation. Set VALUATION_CACHE_TTL_MS=0 to disable.
 */
const _valuationCache = new Map<string, { at: number; data: InvestorValuation }>();
const VALUATION_TTL = Number(process.env.VALUATION_CACHE_TTL_MS ?? 600_000);

export async function valueInvestorCached(tx: Tx, investorId: string, now = Date.now()): Promise<InvestorValuation> {
  if (VALUATION_TTL <= 0) return valueInvestor(tx, investorId);
  const hit = _valuationCache.get(investorId);
  if (hit && now - hit.at < VALUATION_TTL) return hit.data;
  const data = await valueInvestor(tx, investorId);
  _valuationCache.set(investorId, { at: now, data });
  // Bound memory: evict the oldest entries if the map grows large.
  if (_valuationCache.size > 5000) {
    const cutoff = now - VALUATION_TTL;
    for (const [k, v] of _valuationCache) if (v.at < cutoff) _valuationCache.delete(k);
  }
  return data;
}
