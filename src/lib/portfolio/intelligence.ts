/**
 * Portfolio Intelligence — firm- / book-level analytics over the folio book.
 *
 * Sanchay's "Portfolio Details" is a stub (one record); an MFD lives on this.
 * We aggregate the real folio holdings into: asset-class allocation, AMC
 * concentration, top schemes, concentration-risk warnings, classification
 * coverage, direct-plan leakage, and per-client concentration flags.
 *
 * AMC + total come from folios.aum (always present); asset-class + top schemes
 * come from the folio `schemes` jsonb (scheme-level value), degrading
 * gracefully when scheme detail is sparse.
 */

import { sql } from "drizzle-orm";

type Tx = { execute: (q: any) => Promise<{ rows: any[] }> };

export type Slice = { label: string; value: number; pct: number };
export type ConcentratedClient = { id: string; name: string; reason: string; pct: number; aum: number };
export type PortfolioIntel = {
  totalAum: number;
  folioCount: number;
  investorCount: number;
  byClass: Slice[];
  byAmc: Slice[];
  topSchemes: Array<{ scheme: string; amc: string | null; klass: string; value: number; pct: number }>;
  warnings: Array<{ level: "high" | "medium"; text: string }>;
  /** % of book AUM that carries scheme-level value (how much we can analyse). */
  coveragePct: number;
  /** % of measured (scheme-value) holdings we could map to a real class. */
  classifiedPct: number;
  /** Direct-plan holdings — an MFD earns no trail on these (revenue leak). */
  directPlanValue: number;
  directPlanPct: number;
  concentratedClients: ConcentratedClient[];
};

/**
 * Classify a holding by EITHER its AMFI category (authoritative, populated at
 * import from scheme_nav) OR — when category is missing on older imports — its
 * scheme NAME. WHEN order matters: liquid / debt / hybrid are checked before
 * equity so "Equity Savings" (hybrid) and "Banking & PSU" (debt) don't get
 * mis-bucketed by a stray "equity"/"banking" token.
 */
const CLASS_TEXT = `(COALESCE(NULLIF(s->>'category',''),'') || ' ' || COALESCE(s->>'schemeName',''))`;
const CLASS_CASE = `CASE
  WHEN ${CLASS_TEXT} ILIKE ANY (ARRAY['%liquid%','%overnight%','%money market%','%ultra short%','%ultra-short%']) THEN 'Liquid'
  WHEN ${CLASS_TEXT} ILIKE ANY (ARRAY['%debt%','%bond%','%gilt%','%g-sec%','%gsec%','%duration%','%income%','%credit risk%','% psu%','%banking & psu%','%banking and psu%','%floating%','%target maturity%','%fmp%','%fixed maturity%']) THEN 'Debt'
  WHEN ${CLASS_TEXT} ILIKE ANY (ARRAY['%hybrid%','%balanced%','%advantage%','%multi asset%','%multi-asset%','%arbitrage%','%equity savings%','%asset alloc%','%retirement%','%children%']) THEN 'Hybrid'
  WHEN ${CLASS_TEXT} ILIKE ANY (ARRAY['%gold%','%silver%','%commodit%']) THEN 'Commodity'
  WHEN ${CLASS_TEXT} ILIKE ANY (ARRAY['%internat%','%global%','%overseas%','%nasdaq%','%us equity%','%greater china%','%emerging market%']) THEN 'International'
  WHEN ${CLASS_TEXT} ILIKE ANY (ARRAY['%equity%','%elss%','%tax saver%','%large cap%','%large-cap%','%mid cap%','%mid-cap%','%small cap%','%small-cap%','%flexi%','%focus%','%value%','%contra%','%index%','%multi cap%','%multicap%','%bluechip%','%blue chip%','%business cycle%','%dividend yield%','%infrastructure%','%pharma%','%healthcare%','%technology%','%digital%','%consumption%','%manufacturing%','%momentum%','%quality%','%sectoral%','%thematic%','%nifty%','%sensex%','%etf%','%opportunit%','%special situation%','%mnc%','%esg%','%growth%']) THEN 'Equity'
  ELSE 'Other'
END`;
const IS_DIRECT = `(${CLASS_TEXT} ILIKE '%direct%')`;

export async function getPortfolioIntel(
  tx: Tx,
  opts: { tenantId: string; userId: string; firmWide: boolean }
): Promise<PortfolioIntel> {
  const scope = opts.firmWide
    ? sql` AND i.deleted_at IS NULL`
    : sql` AND i.deleted_at IS NULL AND i.rm_id = ${opts.userId}::uuid`;

  const totals = (await tx.execute(sql`
    SELECT COALESCE(SUM(f.aum::numeric),0)::numeric AS total,
           COUNT(*)::int AS folios,
           COUNT(DISTINCT f.investor_id)::int AS investors
    FROM folios f JOIN investors i ON i.id = f.investor_id
    WHERE f.tenant_id = ${opts.tenantId}::uuid ${scope}
  `)).rows[0] as any;
  const totalAum = Number(totals?.total ?? 0);

  const amc = (await tx.execute(sql`
    SELECT f.amc_name AS label, COALESCE(SUM(f.aum::numeric),0)::numeric AS value
    FROM folios f JOIN investors i ON i.id = f.investor_id
    WHERE f.tenant_id = ${opts.tenantId}::uuid ${scope}
    GROUP BY f.amc_name ORDER BY value DESC LIMIT 12
  `)).rows as any[];

  // Asset class + coverage + direct-plan, all from the scheme-level jsonb.
  const klass = (await tx.execute(sql`
    SELECT ${sql.raw(CLASS_CASE)} AS label, COALESCE(SUM(COALESCE((s->>'value')::numeric,0)),0)::numeric AS value
    FROM folios f JOIN investors i ON i.id = f.investor_id, jsonb_array_elements(COALESCE(f.schemes,'[]'::jsonb)) s
    WHERE f.tenant_id = ${opts.tenantId}::uuid ${scope}
    GROUP BY 1 ORDER BY value DESC
  `)).rows as any[];

  const directRow = (await tx.execute(sql`
    SELECT COALESCE(SUM(CASE WHEN ${sql.raw(IS_DIRECT)} THEN COALESCE((s->>'value')::numeric,0) ELSE 0 END),0)::numeric AS direct,
           COALESCE(SUM(COALESCE((s->>'value')::numeric,0)),0)::numeric AS scheme_total
    FROM folios f JOIN investors i ON i.id = f.investor_id, jsonb_array_elements(COALESCE(f.schemes,'[]'::jsonb)) s
    WHERE f.tenant_id = ${opts.tenantId}::uuid ${scope}
  `)).rows[0] as any;

  const top = (await tx.execute(sql`
    SELECT s->>'schemeName' AS scheme, f.amc_name AS amc, ${sql.raw(CLASS_CASE)} AS klass,
           COALESCE(SUM(COALESCE((s->>'value')::numeric,0)),0)::numeric AS value
    FROM folios f JOIN investors i ON i.id = f.investor_id, jsonb_array_elements(COALESCE(f.schemes,'[]'::jsonb)) s
    WHERE f.tenant_id = ${opts.tenantId}::uuid AND (s->>'value') IS NOT NULL ${scope}
    GROUP BY s->>'schemeName', f.amc_name, 3 ORDER BY value DESC LIMIT 10
  `)).rows as any[];

  const pct = (v: number, base: number) => (base > 0 ? Math.round((v / base) * 1000) / 10 : 0);
  const classBase = klass.reduce((a, r) => a + Number(r.value || 0), 0);
  const schemeBase = top.reduce((a, r) => a + Number(r.value || 0), 0) || classBase;

  const byClass: Slice[] = klass.filter((r) => Number(r.value) > 0).map((r) => ({ label: r.label, value: Number(r.value), pct: pct(Number(r.value), classBase) }));
  const byAmc: Slice[] = amc.filter((r) => Number(r.value) > 0).map((r) => ({ label: r.label ?? "Unknown", value: Number(r.value), pct: pct(Number(r.value), totalAum) }));
  const topSchemes = top.filter((r) => Number(r.value) > 0).map((r) => ({ scheme: r.scheme ?? "—", amc: r.amc, klass: r.klass, value: Number(r.value), pct: pct(Number(r.value), schemeBase) }));

  // Coverage: how much of the book has scheme-level value, and of that, how much
  // we could classify (everything that isn't 'Other').
  const schemeTotal = Number(directRow?.scheme_total ?? 0);
  const otherValue = byClass.find((c) => c.label === "Other")?.value ?? 0;
  const coveragePct = totalAum > 0 ? Math.round((schemeTotal / totalAum) * 1000) / 10 : 0;
  const classifiedPct = schemeTotal > 0 ? Math.round(((schemeTotal - otherValue) / schemeTotal) * 1000) / 10 : 0;
  const directPlanValue = Number(directRow?.direct ?? 0);
  const directPlanPct = schemeTotal > 0 ? Math.round((directPlanValue / schemeTotal) * 1000) / 10 : 0;

  // Concentration-risk warnings — the "intelligence" layer.
  const warnings: PortfolioIntel["warnings"] = [];
  const topAmc = byAmc[0];
  if (topAmc && topAmc.pct >= 30) warnings.push({ level: "high", text: `${topAmc.label} is ${topAmc.pct}% of the book — single-AMC concentration risk.` });
  else if (topAmc && topAmc.pct >= 20) warnings.push({ level: "medium", text: `${topAmc.label} is ${topAmc.pct}% of the book — watch AMC concentration.` });
  const equity = byClass.find((c) => c.label === "Equity");
  if (equity && equity.pct >= 85) warnings.push({ level: "high", text: `Equity is ${equity.pct}% of assets — heavy market-risk skew across the book.` });
  const liquidDebt = byClass.filter((c) => c.label === "Liquid" || c.label === "Debt").reduce((a, c) => a + c.pct, 0);
  if (classBase > 0 && classifiedPct >= 50 && liquidDebt < 5) warnings.push({ level: "medium", text: `Only ${liquidDebt.toFixed(1)}% in debt/liquid — limited downside cushion firm-wide.` });
  if (topSchemes[0] && topSchemes[0].pct >= 15) warnings.push({ level: "medium", text: `${topSchemes[0].scheme} alone is ${topSchemes[0].pct}% of measured holdings.` });
  if (directPlanPct >= 10) warnings.push({ level: "high", text: `${directPlanPct}% of measured holdings are DIRECT plans — you earn no trail on these.` });
  if (classifiedPct > 0 && classifiedPct < 60) warnings.push({ level: "medium", text: `Only ${classifiedPct}% of holdings could be classified — import scheme categories for accurate allocation.` });

  const concentratedClients = await getConcentratedClients(tx, opts, scope);

  return {
    totalAum,
    folioCount: Number(totals?.folios ?? 0),
    investorCount: Number(totals?.investors ?? 0),
    byClass,
    byAmc,
    topSchemes,
    warnings,
    coveragePct,
    classifiedPct,
    directPlanValue,
    directPlanPct,
    concentratedClients,
  };
}

/**
 * Clients whose own portfolio is concentrated: a single AMC > 40% of their AUM,
 * or equity > 90% of their classified holdings. The firm-level signal says
 * "there's risk"; this says "in whose books" — so an RM can actually act.
 */
async function getConcentratedClients(tx: Tx, opts: { tenantId: string; userId: string; firmWide: boolean }, scope: any): Promise<ConcentratedClient[]> {
  // Single-AMC concentration (over folio AUM).
  const amcConc = (await tx.execute(sql`
    WITH per AS (
      SELECT i.id, i.name, f.amc_name, SUM(f.aum::numeric) AS amc_aum
      FROM folios f JOIN investors i ON i.id = f.investor_id
      WHERE f.tenant_id = ${opts.tenantId}::uuid ${scope}
      GROUP BY i.id, i.name, f.amc_name
    ), roll AS (
      SELECT id, name, SUM(amc_aum) AS tot, MAX(amc_aum) AS top_amc
      FROM per GROUP BY id, name
    )
    SELECT id, name, tot, top_amc, ROUND((top_amc / NULLIF(tot,0)) * 100, 1) AS pct
    FROM roll
    WHERE tot >= 50000 AND (top_amc / NULLIF(tot,0)) >= 0.40
    ORDER BY pct DESC LIMIT 25
  `)).rows as any[];

  // Equity concentration (over scheme value).
  const eqConc = (await tx.execute(sql`
    WITH per AS (
      SELECT i.id, i.name,
        SUM(COALESCE((s->>'value')::numeric,0)) AS sv,
        SUM(CASE WHEN ${sql.raw(CLASS_CASE)} = 'Equity' THEN COALESCE((s->>'value')::numeric,0) ELSE 0 END) AS ev
      FROM folios f JOIN investors i ON i.id = f.investor_id, jsonb_array_elements(COALESCE(f.schemes,'[]'::jsonb)) s
      WHERE f.tenant_id = ${opts.tenantId}::uuid ${scope}
      GROUP BY i.id, i.name
    )
    SELECT id, name, sv, ev, ROUND((ev / NULLIF(sv,0)) * 100, 1) AS pct
    FROM per
    WHERE sv >= 50000 AND (ev / NULLIF(sv,0)) >= 0.90
    ORDER BY pct DESC LIMIT 25
  `)).rows as any[];

  const out = new Map<string, ConcentratedClient>();
  for (const r of amcConc) {
    out.set(r.id, { id: r.id, name: r.name, reason: `Single-AMC ${r.pct}%`, pct: Number(r.pct), aum: Number(r.tot) });
  }
  for (const r of eqConc) {
    const existing = out.get(r.id);
    const reason = `Equity ${r.pct}%`;
    if (existing) existing.reason += ` · ${reason}`;
    else out.set(r.id, { id: r.id, name: r.name, reason, pct: Number(r.pct), aum: Number(r.sv) });
  }
  return [...out.values()].sort((a, b) => b.aum - a.aum).slice(0, 20);
}
