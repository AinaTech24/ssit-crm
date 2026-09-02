/**
 * Resolve RTA folio schemes to their CANONICAL identity using the AMFI master.
 *
 * RTA files identify schemes by registrar-internal codes (CAMS single-letter AMC
 * codes like "P"/"K", KFintech fund codes like "117") and a scheme description.
 * The authoritative names live in `scheme_nav` — the daily AMFI NAVAll feed —
 * which maps  ISIN → AMFI scheme code → canonical scheme name → AMC name.
 *
 * For every scheme we resolve, in order of confidence:
 *   1. by ISIN (exact) → set canonical scheme name, the AMFI scheme code (which
 *      makes live-NAV valuation join), and the real AMC name.
 *   2. by exact normalized scheme NAME → same, for files without an ISIN column.
 *   3. otherwise leave the parser's value (heuristic AMC) untouched.
 *
 * Mutates `records` in place. `scheme_nav` is platform-shared reference data
 * (no RLS), so it's readable inside any tenant transaction.
 */

import { sql } from "drizzle-orm";
import type { RtaFolioRecord } from "./types";

type Tx = any;
type Hit = { amcName: string | null; schemeName: string; amfiCode: string; category: string | null };

/** Normalize a scheme name for matching: lower-case, alphanumerics only,
 *  collapse whitespace. Keeps plan/option words so a match is plan-specific. */
function normName(s: string | undefined | null): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function resolveSchemeIdentity(tx: Tx, records: RtaFolioRecord[]): Promise<{ resolved: number; total: number }> {
  // Collect distinct ISINs across all schemes.
  const isins = new Set<string>();
  let total = 0;
  for (const r of records)
    for (const s of r.schemes) {
      total++;
      if (s.isin) isins.add(s.isin.toUpperCase());
    }
  if (total === 0) return { resolved: 0, total: 0 };

  // 1. ISIN → identity.
  const isinMap = new Map<string, Hit>();
  if (isins.size) {
    const rows = await tx.execute(sql`
      SELECT isin, scheme_code, scheme_name, amc_name, scheme_category FROM scheme_nav WHERE isin IN (${sql.join([...isins].map((v) => sql`${v}`), sql`, `)})
    `);
    for (const row of rows.rows as any[]) {
      if (row.isin) isinMap.set(String(row.isin).toUpperCase(), { amcName: row.amc_name, schemeName: row.scheme_name, amfiCode: String(row.scheme_code), category: row.scheme_category ?? null });
    }
  }

  // 2. Normalized scheme name → identity (loaded once, only if needed).
  let nameMap: Map<string, Hit> | null = null;
  const ensureNameMap = async (): Promise<Map<string, Hit>> => {
    if (nameMap) return nameMap;
    nameMap = new Map();
    const rows = await tx.execute(sql`SELECT scheme_code, scheme_name, amc_name, scheme_category FROM scheme_nav`);
    for (const row of rows.rows as any[]) {
      const k = normName(row.scheme_name);
      if (k && !nameMap.has(k)) nameMap.set(k, { amcName: row.amc_name, schemeName: row.scheme_name, amfiCode: String(row.scheme_code), category: row.scheme_category ?? null });
    }
    return nameMap;
  };

  let resolved = 0;
  for (const r of records) {
    let amcForFolio: string | null = null;
    for (const s of r.schemes) {
      let hit: Hit | undefined | null = s.isin ? isinMap.get(s.isin.toUpperCase()) : null;
      if (!hit && s.schemeName) {
        const nm = await ensureNameMap();
        hit = nm.get(normName(s.schemeName));
      }
      if (hit) {
        if (hit.schemeName) s.schemeName = hit.schemeName;
        // The AMFI scheme code is what scheme_nav/valuation key on — adopting it
        // lets revalueAllFolios price this holding at live NAV.
        if (hit.amfiCode) s.schemeCode = hit.amfiCode;
        // Adopt the AMFI category so Portfolio Intelligence can bucket the holding
        // by real asset class (was previously left blank → everything "Other").
        if (hit.category && !s.category) (s as any).category = hit.category;
        if (!amcForFolio && hit.amcName) amcForFolio = hit.amcName;
        resolved++;
      }
    }
    // A folio is a single AMC; use the resolved AMC name for display. Keep
    // amcCode (the RTA code) unchanged — it's the folio's stable uniqueness key.
    if (amcForFolio) r.amcName = amcForFolio;
  }

  return { resolved, total };
}
