/**
 * Risk-Drift Radar — flags clients whose ACTUAL portfolio equity allocation has
 * drifted from what their signed risk profile implies. Powers
 * /dashboard/reports/risk-drift.
 *
 * How it works, end to end:
 *  1. Every scheme held in a client's folios is classified equity/debt/hybrid/
 *     other from the imported `category` string first, then a scheme-NAME regex
 *     fallback (RTA files don't always carry a category).
 *  2. The client's actual equity % is computed from per-scheme `value`s when the
 *     holdings import carried them; otherwise the folio's dominant scheme is
 *     classified and the whole folio AUM attributed to that class (documented
 *     fallback — coarse but honest).
 *  3. That equity % is compared against the target band implied by the signed
 *     risk profile (see equityBandForProfile). Outside the band = drift, and
 *     the drift is measured in percentage points from the nearest band edge.
 *
 * Tenant scoping is the caller's (pass the tx from withTenant — RLS scopes the
 * rows; the explicit tenant_id predicate is belt-and-braces).
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";

export type AssetClass = "equity" | "debt" | "hybrid" | "other";

/** How much of each asset class counts as equity exposure.
 *  Hybrid counts 65% equity / 35% debt — the aggressive-hybrid / balanced-
 *  advantage norm (SEBI aggressive hybrid mandate is 65–80% equity; 65 is the
 *  conservative end, so we never overstate a client's drift). */
const EQUITY_WEIGHT: Record<AssetClass, number> = {
  equity: 1,
  debt: 0,
  hybrid: 0.65,
  other: 0, // gold/international/unclassifiable — not counted as equity
};

// Category-string keywords (checked FIRST — the RTA/AMFI category is the most
// reliable signal when present). Hybrid before equity so "Aggressive Hybrid
// Equity" classifies hybrid, not equity.
const HYBRID_RX = /hybrid|balanced|advantage|multi[\s-]?asset|asset\s*allocat/i;
const DEBT_RX =
  /debt|liquid|gilt|money\s*market|overnight|ultra|duration|bond|credit\s*risk|corporate\s*bond|banking\s*(&|and)\s*psu|floater|fmp|fixed\s*maturity|income\s*fund/i;
const EQUITY_RX =
  /equity|elss|index|sectoral|thematic|flexi[\s-]?cap|multi[\s-]?cap|large[\s-]?cap|mid[\s-]?cap|small[\s-]?cap|focused|value\s*fund|contra|dividend\s*yield|nifty|sensex|tax\s*saver/i;

/**
 * Classify a scheme into an asset class. The imported category string wins;
 * the scheme name is the regex fallback. Anything unmatched is "other"
 * (gold, international FoF, etc.) and counts 0% equity.
 */
export function classifyScheme(schemeName: string, category?: string | null): AssetClass {
  for (const s of [category ?? "", schemeName ?? ""]) {
    if (!s) continue;
    if (HYBRID_RX.test(s)) return "hybrid";
    if (DEBT_RX.test(s)) return "debt";
    if (EQUITY_RX.test(s)) return "equity";
  }
  return "other";
}

export type RiskProfile = "conservative" | "moderate" | "aggressive" | "very_aggressive";

export type EquityBand = { min: number; max: number };

/**
 * Target equity range implied by each signed risk profile (the REAL
 * investors.risk_profile enum values). Mapping:
 *
 *   conservative     →  0–30% equity  (capital preservation)
 *   moderate         → 30–60% equity  (balanced growth)
 *   aggressive       → 55–85% equity  (growth-tilted)
 *   very_aggressive  → 70–100% equity (max growth)
 *
 * Bands deliberately overlap a little at the edges so a client sitting right on
 * a boundary isn't flagged by both neighbouring profiles.
 */
export function equityBandForProfile(profile: RiskProfile): EquityBand {
  switch (profile) {
    case "conservative":
      return { min: 0, max: 30 };
    case "moderate":
      return { min: 30, max: 60 };
    case "aggressive":
      return { min: 55, max: 85 };
    case "very_aggressive":
      return { min: 70, max: 100 };
  }
}

export const RISK_PROFILE_LABELS: Record<RiskProfile, string> = {
  conservative: "Conservative",
  moderate: "Moderate",
  aggressive: "Aggressive",
  very_aggressive: "Very aggressive",
};

/** Themed chip classes per profile — mirrors the tone ladder used elsewhere. */
export function riskProfileChipClasses(profile: RiskProfile): string {
  switch (profile) {
    case "conservative":
      return "bg-sky-500/10 text-sky-700 border-sky-500/30";
    case "moderate":
      return "bg-emerald-500/10 text-emerald-700 border-emerald-500/30";
    case "aggressive":
      return "bg-amber-500/10 text-amber-700 border-amber-500/30";
    case "very_aggressive":
      return "bg-rose-500/10 text-rose-700 border-rose-500/30";
  }
}

export type DriftDirection = "too_aggressive" | "too_conservative";

export type RiskDriftRow = {
  investorId: string;
  name: string;
  riskProfile: RiskProfile;
  /** Actual equity exposure, 0–100 (hybrid counted 65% equity). */
  equityPct: number;
  /** Target band implied by the signed risk profile. */
  band: EquityBand;
  /** Percentage points outside the band — 0 when inside. */
  driftPts: number;
  /** Only meaningful when driftPts > 0. */
  direction: DriftDirection | null;
  aum: number;
  rmId: string | null;
};

export type RiskDriftSummary = {
  checked: number;
  drifted: number;
  tooAggressive: number;
  tooConservative: number;
};

type FolioBlob = {
  aum: string | number | null;
  schemes: Array<{ schemeName?: string; category?: string; units?: number; value?: number }> | null;
};

/**
 * Whole-book risk-drift scan: clients with a signed risk profile AND folio
 * AUM > 0, top 500 by AUM (largest books matter most and it bounds the JSONB
 * work). Returns rows sorted by drift (worst first) + a summary.
 */
export async function computeRiskDrift(
  tx: Tx,
  tenantId: string,
  opts: { rmId?: string } = {}
): Promise<{ rows: RiskDriftRow[]; summary: RiskDriftSummary }> {
  // RM scope: when an rmId is passed (a non-manager viewing their own book),
  // only that RM's clients are scanned — managers pass no rmId.
  const rmScope = opts.rmId ? sql` AND i.rm_id = ${opts.rmId}::uuid` : sql``;

  const res = await tx.execute(sql`
    SELECT
      i.id, i.name, i.risk_profile, i.rm_id,
      COALESCE(SUM(f.aum::numeric), 0) AS folio_aum,
      jsonb_agg(jsonb_build_object('aum', f.aum, 'schemes', f.schemes)) AS folios
    FROM investors i
    JOIN folios f ON f.investor_id = i.id AND f.closed_at IS NULL
    WHERE i.tenant_id = ${tenantId}::uuid
      AND i.risk_profile IS NOT NULL
      AND i.deleted_at IS NULL${rmScope}
    GROUP BY i.id
    HAVING COALESCE(SUM(f.aum::numeric), 0) > 0
    ORDER BY SUM(f.aum::numeric) DESC
    LIMIT 500
  `);

  const rows: RiskDriftRow[] = [];

  for (const r of res.rows as any[]) {
    const folioBlobs: FolioBlob[] = Array.isArray(r.folios) ? r.folios : [];

    // Accumulate equity-weighted value and total classified value across folios.
    let equityValue = 0;
    let totalValue = 0;

    for (const f of folioBlobs) {
      const folioAum = Number(f.aum ?? 0);
      const schemes = Array.isArray(f.schemes) ? f.schemes : [];

      // Preferred path: per-scheme values from the holdings import.
      const valued = schemes.filter((s) => Number(s?.value ?? 0) > 0);
      if (valued.length > 0) {
        for (const s of valued) {
          const v = Number(s.value);
          equityValue += v * EQUITY_WEIGHT[classifyScheme(s.schemeName ?? "", s.category)];
          totalValue += v;
        }
        continue;
      }

      // Fallback: no per-scheme values — classify the folio's dominant scheme
      // (most units when available, else the first listed) and attribute the
      // whole folio AUM to that class. Coarse, but folios are usually
      // single-scheme in RTA masters so it's right far more often than not.
      if (folioAum > 0 && schemes.length > 0) {
        const dominant = schemes.reduce((best, s) =>
          Number(s?.units ?? 0) > Number(best?.units ?? 0) ? s : best
        );
        equityValue += folioAum * EQUITY_WEIGHT[classifyScheme(dominant.schemeName ?? "", dominant.category)];
        totalValue += folioAum;
      }
    }

    if (totalValue <= 0) continue; // no classifiable holdings — nothing to compare

    const equityPct = Math.round((equityValue / totalValue) * 1000) / 10; // 1 decimal
    const profile = r.risk_profile as RiskProfile;
    const band = equityBandForProfile(profile);

    let driftPts = 0;
    let direction: DriftDirection | null = null;
    if (equityPct > band.max) {
      driftPts = Math.round((equityPct - band.max) * 10) / 10;
      direction = "too_aggressive";
    } else if (equityPct < band.min) {
      driftPts = Math.round((band.min - equityPct) * 10) / 10;
      direction = "too_conservative";
    }

    rows.push({
      investorId: r.id,
      name: r.name,
      riskProfile: profile,
      equityPct,
      band,
      driftPts,
      direction,
      aum: Number(r.folio_aum),
      rmId: r.rm_id ?? null,
    });
  }

  rows.sort((a, b) => b.driftPts - a.driftPts || b.aum - a.aum);

  const drifted = rows.filter((x) => x.driftPts > 0);
  const summary: RiskDriftSummary = {
    checked: rows.length,
    drifted: drifted.length,
    tooAggressive: drifted.filter((x) => x.direction === "too_aggressive").length,
    tooConservative: drifted.filter((x) => x.direction === "too_conservative").length,
  };

  return { rows, summary };
}
