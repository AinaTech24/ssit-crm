/**
 * mfapi.in integration — the public Mutual Fund scheme + NAV API
 * (https://www.mfapi.in/docs/). Two endpoints:
 *
 *   GET /mf            → [{ schemeCode, schemeName }]                (full catalog, ~12k)
 *   GET /mf/{code}     → { meta:{fund_house, scheme_type,
 *                          scheme_category, scheme_name, isin_growth…},
 *                          data:[{ date:"dd-MM-yyyy", nav:"123.45" }] }  (detail + history)
 *
 * The catalog is PLATFORM-SHARED (mf_schemes, no tenant_id) and refreshed by a
 * daily worker so every MFD tenant reads the same up-to-date scheme/AMC/NAV
 * data. Writes go through withSystem() (RLS: platform-admin write only).
 */

import { sql } from "drizzle-orm";
import { withSystem } from "@/db/client";

export const MFAPI_BASE = process.env.MFAPI_BASE_URL ?? "https://api.mfapi.in";

export type MfApiListItem = { schemeCode: number | string; schemeName: string };
export type MfApiNavPoint = { date: string; nav: string };
export type MfApiScheme = {
  meta?: {
    fund_house?: string;
    scheme_type?: string;
    scheme_category?: string;
    scheme_name?: string;
    isin_growth?: string | null;
    isin_div_reinvestment?: string | null;
  };
  data?: MfApiNavPoint[];
  status?: string;
};

const UA = { "user-agent": "ssit-crm/mfapi-sync" };

/** mfapi dates are "dd-MM-yyyy"; convert to ISO "yyyy-MM-dd" (or null). */
export function parseMfApiDate(s?: string | null): string | null {
  if (!s) return null;
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s.trim());
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

export async function fetchMfApiList(): Promise<MfApiListItem[]> {
  const res = await fetch(`${MFAPI_BASE}/mf`, { headers: UA, signal: AbortSignal.timeout(45_000) });
  if (!res.ok) throw new Error(`mfapi /mf HTTP ${res.status}`);
  const json = (await res.json()) as MfApiListItem[];
  if (!Array.isArray(json)) throw new Error("mfapi /mf: unexpected payload");
  return json;
}

export async function fetchMfApiScheme(code: string): Promise<MfApiScheme | null> {
  try {
    const res = await fetch(`${MFAPI_BASE}/mf/${encodeURIComponent(code)}`, {
      headers: UA,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as MfApiScheme;
    return json && typeof json === "object" ? json : null;
  } catch {
    return null;
  }
}

/** NAV history for one scheme (most-recent first), ISO-dated — for the detail API. */
export async function getMfNavHistory(
  code: string,
  limit = 60
): Promise<{ schemeName?: string; fundHouse?: string; points: Array<{ date: string; nav: number }> } | null> {
  const s = await fetchMfApiScheme(code);
  if (!s) return null;
  const points = (s.data ?? [])
    .map((p) => ({ date: parseMfApiDate(p.date), nav: Number(p.nav) }))
    .filter((p): p is { date: string; nav: number } => !!p.date && Number.isFinite(p.nav))
    .slice(0, limit);
  return { schemeName: s.meta?.scheme_name, fundHouse: s.meta?.fund_house, points };
}

/**
 * Daily step 1 — upsert the full scheme list (code + name) into mf_schemes.
 * Cheap: a single bulk GET. Preserves any enrichment already on the row.
 */
export async function syncMfSchemeCatalog(): Promise<{ fetched: number; written: number }> {
  const list = await fetchMfApiList();
  // De-dupe by code (the feed occasionally repeats a code).
  const seen = new Map<string, string>();
  for (const it of list) {
    const code = String(it.schemeCode ?? "").trim();
    const name = String(it.schemeName ?? "").trim();
    if (code && name && !seen.has(code)) seen.set(code, name);
  }
  const rows = [...seen.entries()];
  const BATCH = 500;
  let written = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    await withSystem(async (tx) => {
      const values = sql.join(
        batch.map(([code, name]) => sql`(${code}, ${name}, now())`),
        sql`, `
      );
      await tx.execute(sql`
        INSERT INTO mf_schemes (scheme_code, scheme_name, updated_at)
        VALUES ${values}
        ON CONFLICT (scheme_code) DO UPDATE SET
          scheme_name = EXCLUDED.scheme_name,
          is_active = true,
          updated_at = now()
      `);
    });
    written += batch.length;
  }
  return { fetched: list.length, written };
}

/**
 * Daily step 2 — bounded enrichment: pull per-scheme detail (fund house, type,
 * category, ISIN, latest NAV) for up to `cap` schemes that have never been
 * enriched (synced_at IS NULL) or are stale (> 20 days). Progressive backfill —
 * never hammers mfapi with all ~12k per-scheme calls at once.
 */
export async function enrichMfSchemes(cap = 1500): Promise<{ scanned: number; updated: number }> {
  const targets = await withSystem(async (tx) => {
    const r = await tx.execute(sql`
      SELECT scheme_code FROM mf_schemes
      WHERE synced_at IS NULL OR synced_at < now() - interval '20 days'
      ORDER BY synced_at NULLS FIRST
      LIMIT ${cap}
    `);
    return (r.rows as Array<{ scheme_code: string }>).map((x) => x.scheme_code);
  });
  if (targets.length === 0) return { scanned: 0, updated: 0 };

  // Fetch details in concurrency-limited batches (HTTP outside any DB tx).
  const CONC = 12;
  type Row = {
    code: string;
    fundHouse: string | null;
    schemeType: string | null;
    schemeCategory: string | null;
    isin: string | null;
    nav: number | null;
    navDate: string | null;
  };
  const details: Row[] = [];
  for (let i = 0; i < targets.length; i += CONC) {
    const slice = targets.slice(i, i + CONC);
    const got = await Promise.all(
      slice.map(async (code) => {
        const s = await fetchMfApiScheme(code);
        if (!s) return null;
        const latest = s.data?.[0];
        return {
          code,
          fundHouse: s.meta?.fund_house ?? null,
          schemeType: s.meta?.scheme_type ?? null,
          schemeCategory: s.meta?.scheme_category ?? null,
          isin: s.meta?.isin_growth ?? null,
          nav: latest ? Number(latest.nav) : null,
          navDate: latest ? parseMfApiDate(latest.date) : null,
        } as Row;
      })
    );
    for (const g of got) if (g) details.push(g);
  }

  // Persist in one system tx (per-row UPDATEs; bounded by cap).
  let updated = 0;
  const UBATCH = 300;
  for (let i = 0; i < details.length; i += UBATCH) {
    const batch = details.slice(i, i + UBATCH);
    await withSystem(async (tx) => {
      for (const d of batch) {
        await tx.execute(sql`
          UPDATE mf_schemes SET
            fund_house = COALESCE(${d.fundHouse}, fund_house),
            scheme_type = COALESCE(${d.schemeType}, scheme_type),
            scheme_category = COALESCE(${d.schemeCategory}, scheme_category),
            isin = COALESCE(${d.isin}, isin),
            nav = ${d.nav},
            nav_date = ${d.navDate}::date,
            synced_at = now(),
            updated_at = now()
          WHERE scheme_code = ${d.code}
        `);
        updated++;
      }
    });
  }
  return { scanned: targets.length, updated };
}
