/**
 * Asset-class exposure from a client's folios. Mirrors the bucketing used by
 * the PortfolioAllocation card, then rolls buckets up into a growth/defensive
 * split so the suitability check can compare equity exposure to a risk profile.
 */

type FolioWithSchemes = {
  aum?: string | number | null;
  schemes?: Array<{ category?: string; value?: number }> | null;
};

const EQUITY_RX = [/equity/i, /large.?cap/i, /mid.?cap/i, /small.?cap/i, /flexi.?cap/i, /multi.?cap/i, /focused/i, /thematic/i, /sectoral/i, /elss/i, /tax.?saver/i, /index/i, /etf/i, /nifty/i, /sensex/i, /international/i, /global/i, /nasdaq/i, /emerging.?market/i];
const HYBRID_RX = [/hybrid/i, /balanced/i];
const DEFENSIVE_RX = [/debt/i, /bond/i, /gilt/i, /income/i, /credit.?risk/i, /duration/i, /banking.?psu/i, /liquid/i, /overnight/i, /money.?market/i, /ultra.?short/i];

function classOf(category: string | undefined): "equity" | "hybrid" | "defensive" | "other" {
  if (!category) return "other";
  if (EQUITY_RX.some((r) => r.test(category))) return "equity";
  if (HYBRID_RX.some((r) => r.test(category))) return "hybrid";
  if (DEFENSIVE_RX.some((r) => r.test(category))) return "defensive";
  return "other";
}

export type Exposure = {
  total: number;
  equity: number;
  defensive: number;
  /** Equity exposure as a % of classified value (hybrids count as half equity). */
  equityPct: number | null;
  /** How much value we could actually classify (coverage). */
  classifiedPct: number;
};

/** Roll a client's folio schemes into an equity / defensive exposure split. */
export function assetClassExposure(folios: FolioWithSchemes[]): Exposure {
  let total = 0;
  let equity = 0;
  let defensive = 0;
  let classified = 0;

  for (const f of folios) {
    const folAum = Number(f.aum ?? 0);
    const schemes = f.schemes ?? [];
    if (!schemes.length) {
      total += folAum;
      continue;
    }
    const haveValues = schemes.some((s) => s.value && s.value > 0);
    for (const s of schemes) {
      const v = haveValues ? Number(s.value ?? 0) : folAum / schemes.length;
      if (!v || v <= 0) continue;
      total += v;
      const c = classOf(s.category);
      if (c === "equity") { equity += v; classified += v; }
      else if (c === "hybrid") { equity += v * 0.5; defensive += v * 0.5; classified += v; }
      else if (c === "defensive") { defensive += v; classified += v; }
    }
  }

  return {
    total,
    equity,
    defensive,
    equityPct: classified > 0 ? (equity / classified) * 100 : null,
    classifiedPct: total > 0 ? (classified / total) * 100 : 0,
  };
}
