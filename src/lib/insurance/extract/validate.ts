/**
 * Field validators. A classified value that fails its format check is treated as
 * not-found (value→null, confidence→0) rather than auto-filled — "never guess".
 */

const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;
const PIN = /^[1-9][0-9]{5}$/;

export const isEmail = (v: string) => EMAIL.test(v.trim());
export const isPan = (v: string) => PAN.test(v.trim().toUpperCase());
export const isGstin = (v: string) => GSTIN.test(v.trim().toUpperCase());
export const isPin = (v: string) => PIN.test(v.trim());

/** Indian mobile (10 digits, 6-9 lead) after stripping +91/0 and separators. */
export function isPhone(v: string): boolean {
  const d = v.replace(/[^\d]/g, "").replace(/^(91|0)/, "");
  return /^[6-9][0-9]{9}$/.test(d) || /^1[89]00[0-9]{6,7}$/.test(v.replace(/[^\d]/g, ""));
}

/** A clean ISO date that actually exists on the calendar. */
export function isIsoDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** A policy/receipt number free of OCR junk — alnum with / and - only. */
export function isCleanRef(v: string): boolean {
  const t = v.trim();
  return t.length >= 4 && t.length <= 40 && /^[A-Za-z0-9][A-Za-z0-9\/\-]*$/.test(t);
}

/** Parse a money string ("₹1,25,000.00", "Rs. 1,25,000.00") to a number, or null. */
export function toMoney(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v).replace(/[^\d.]/g, ""); // keep digits + dots
  if (!s) return null;
  // Collapse all-but-the-last dot (the "Rs." dot / Indian grouping shouldn't
  // become a decimal point) so "Rs. 1,25,000.00" → "125000.00", not 0.125.
  const parts = s.split(".");
  if (parts.length > 2) s = parts.slice(0, -1).join("") + "." + parts[parts.length - 1];
  s = s.replace(/^\.+/, "");
  if (!s || s === ".") return null;
  const n = parseFloat(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Best-effort normalise a date to ISO yyyy-mm-dd (handles dd/mm/yyyy + dd Mon yyyy). */
export function toIso(v: unknown): string | null {
  if (!v) return null;
  const s = String(v).trim();
  if (isIsoDate(s)) return s;
  let m = s.match(/^([0-3]?\d)[\/\-.]([01]?\d)[\/\-.]((?:19|20)\d{2})$/);
  if (m) {
    const iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    return isIsoDate(iso) ? iso : null;
  }
  const MON: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
  m = s.match(/^([0-3]?\d)[\s-]([A-Za-z]{3})[a-z]*[\s-,]*((?:19|20)\d{2})$/);
  if (m) {
    const mm = MON[m[2].toLowerCase()];
    if (mm) {
      const iso = `${m[3]}-${mm}-${m[1].padStart(2, "0")}`;
      return isIsoDate(iso) ? iso : null;
    }
  }
  return null;
}
