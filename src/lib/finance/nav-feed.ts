/**
 * AMFI NAV feed ingestion.
 *
 * AMFI publishes the NAV of EVERY mutual-fund scheme in India once a day as a
 * single public, auth-free text file. We download it, parse the pipe-delimited
 * rows, and upsert into `scheme_nav` (platform-shared reference data). Folio /
 * transaction valuation then joins on the AMFI scheme code.
 *
 * Feed format (semicolon-delimited, grouped by AMC + category):
 *
 *   Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date
 *
 *   Open Ended Schemes(Equity Scheme - Flexi Cap Fund)
 *
 *   Aditya Birla Sun Life Mutual Fund
 *   119551;INF209K01YM2;INF209K01YN0;Aditya Birla Sun Life Flexi Cap Fund - Growth;1834.56;30-May-2026
 *   ...
 *
 * Standalone (no-semicolon) lines are either an AMC name or a category header;
 * we track the most recent AMC name to tag each scheme. Blank lines + the header
 * row are skipped.
 */

import { sql } from "drizzle-orm";
import { withSystem } from "@/db/client";

export const AMFI_NAVALL_URL =
  process.env.AMFI_NAVALL_URL ?? "https://www.amfiindia.com/spages/NAVAll.txt";

export type NavRecord = {
  schemeCode: string;
  isin: string | null;
  /** Dividend-Reinvestment ISIN (AMFI col 2), kept distinct from `isin`. */
  isinReinvest: string | null;
  schemeName: string;
  amcName: string | null;
  /** "Open Ended" / "Close Ended" / "Interval" — from the section header. */
  schemeType: string | null;
  /** Granular AMFI category from the section header (e.g. "Equity Scheme - Flexi Cap Fund"). */
  schemeCategory: string | null;
  nav: number;
  navDate: string; // ISO yyyy-mm-dd
};

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** Parse AMFI's "30-May-2026" into ISO "2026-05-30", or null if unparseable. */
export function parseAmfiDate(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (!m) return null;
  const day = m[1].padStart(2, "0");
  const mon = MONTHS[m[2].toLowerCase()];
  if (!mon) return null;
  return `${m[3]}-${mon}-${day}`;
}

/**
 * Parse the raw NAVAll.txt body into NavRecords. Pure + synchronous so it's
 * unit-testable without a network call.
 */
export function parseNavAll(body: string): NavRecord[] {
  const out: NavRecord[] = [];
  let currentAmc: string | null = null;
  let currentType: string | null = null;
  let currentCategory: string | null = null;
  const lines = body.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (!trimmed.includes(";")) {
      // Standalone line: a section header ("Open Ended Schemes(Equity Scheme -
      // Flexi Cap Fund)") or an AMC name. A header states the scheme STRUCTURE
      // and the granular CATEGORY — capture both so every scheme below it is
      // tagged, rather than discarding the header as before. Everything else is
      // the current AMC name.
      const hm = trimmed.match(/^(open ended|close ended|interval)\b[^(]*\((.+)\)\s*$/i);
      if (hm) {
        currentType = hm[1]
          .toLowerCase()
          .replace(/\b\w/g, (c) => c.toUpperCase()); // "Open Ended" / "Close Ended" / "Interval"
        currentCategory = hm[2].trim() || null;
        continue;
      }
      // A header keyword with no parenthesised category still isn't an AMC.
      if (/^(open ended|close ended|interval)/i.test(trimmed)) {
        currentCategory = null;
        continue;
      }
      currentAmc = trimmed;
      continue;
    }

    const cols = trimmed.split(";");
    // Expect: code; isinGrowth; isinReinvest; name; nav; date
    if (cols.length < 6) continue;
    const schemeCode = cols[0].trim();
    if (!/^\d+$/.test(schemeCode)) continue; // skip the header row + junk

    const navRaw = cols[4].trim();
    const nav = Number(navRaw);
    if (!isFinite(nav) || nav <= 0) continue; // "N.A." or suspended schemes

    const navDate = parseAmfiDate(cols[5]);
    if (!navDate) continue;

    out.push({
      schemeCode,
      // Primary keeps the existing fallback (some schemes list only the reinvest
      // ISIN) so folio matching on scheme_nav.isin doesn't regress.
      isin: cols[1].trim() || cols[2].trim() || null,
      isinReinvest: cols[2].trim() || null,
      schemeName: cols[3].trim(),
      amcName: currentAmc,
      schemeType: currentType,
      schemeCategory: currentCategory,
      nav,
      navDate,
    });
  }
  return out;
}

/** Download the live AMFI feed. Throws on non-200 or network failure. */
export async function fetchNavAll(): Promise<string> {
  const res = await fetch(AMFI_NAVALL_URL, {
    headers: { "user-agent": "mfd-platform/nav-feed" },
    // The feed is ~8MB; give it room.
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`AMFI feed HTTP ${res.status}`);
  return await res.text();
}

/**
 * Upsert NAV records into scheme_nav in batches. Returns the count written.
 * Uses withSystem (the table has no RLS, but withSystem is the consistent
 * cross-tenant maintenance entry point).
 */
export async function upsertNavs(records: NavRecord[]): Promise<number> {
  if (records.length === 0) return 0;
  const BATCH = 500;
  let written = 0;

  for (let i = 0; i < records.length; i += BATCH) {
    const batch = records.slice(i, i + BATCH);
    await withSystem(async (tx) => {
      // Build a single multi-row INSERT ... ON CONFLICT for the batch.
      const values = sql.join(
        batch.map(
          (r) =>
            sql`(${r.schemeCode}, ${r.isin}, ${r.isinReinvest}, ${r.schemeName}, ${r.amcName}, ${r.schemeType}, ${r.schemeCategory}, ${r.nav}, ${r.navDate}, now())`
        ),
        sql`, `
      );
      await tx.execute(sql`
        INSERT INTO scheme_nav (scheme_code, isin, isin_reinvest, scheme_name, amc_name, scheme_type, scheme_category, nav, nav_date, updated_at)
        VALUES ${values}
        ON CONFLICT (scheme_code) DO UPDATE SET
          isin = EXCLUDED.isin,
          isin_reinvest = EXCLUDED.isin_reinvest,
          scheme_name = EXCLUDED.scheme_name,
          amc_name = EXCLUDED.amc_name,
          scheme_type = COALESCE(EXCLUDED.scheme_type, scheme_nav.scheme_type),
          scheme_category = COALESCE(EXCLUDED.scheme_category, scheme_nav.scheme_category),
          nav = EXCLUDED.nav,
          nav_date = EXCLUDED.nav_date,
          updated_at = now()
      `);
    });
    written += batch.length;
  }
  return written;
}

/** Full pipeline: fetch → parse → upsert. Returns a summary. */
export async function refreshNav(): Promise<{
  fetched: number;
  written: number;
  navDate: string | null;
}> {
  const body = await fetchNavAll();
  const records = parseNavAll(body);
  const written = await upsertNavs(records);
  // Most-common nav date across the feed (sanity field for logs).
  const navDate = records.length ? records[records.length - 1].navDate : null;
  return { fetched: records.length, written, navDate };
}
