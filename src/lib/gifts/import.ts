/** Reading a gift sheet: dates the way an Indian office writes them (day first). Pure functions. */

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const iso = (y: number, m: number, d: number): string | null => {
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};
const fullYear = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));

/**
 * "27-11-2026", "27/11/26", "27.11.2026", "27 Nov 2026", "27-Nov-26" and "2026-11-27" -> "2026-11-27".
 * Numbers are ALWAYS read day-month-year; anything else is rejected rather than guessed (a month-first guess
 * silently filed a November gift under May).
 */
export function parseSheetDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    // A date cell arrives as local midnight; noon keeps the calendar day whatever the server's time zone.
    return new Date(v.getTime() + 12 * 3_600_000).toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:T.*)?$/);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4}|\d{2})$/);
  if (m) return iso(fullYear(m[3]), Number(m[2]), Number(m[1]));
  m = s.match(/^(\d{1,2})[\s\-\/]+([A-Za-z]{3,9})\.?[\s\-\/,]+(\d{4}|\d{2})$/);
  if (m) {
    const month = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1;
    return month ? iso(fullYear(m[3]), month, Number(m[1])) : null;
  }
  return null;
}

/** A client name as typed in a sheet vs on record: spacing and capitals do not matter. */
export const nameKey = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
