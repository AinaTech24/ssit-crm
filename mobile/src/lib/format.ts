/**
 * Formatting helpers shared across screens. Indian number conventions (lakh /
 * crore) for money, since that's how MFDs read AUM/SIP.
 */

export function toNumber(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

/** Compact INR: ₹1.2Cr, ₹3.4L, ₹45,000, ₹0. */
export function inr(value: unknown): string {
  const n = toNumber(value);
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2).replace(/\.00$/, "")}Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2).replace(/\.00$/, "")}L`;
  if (abs >= 1000) return `${sign}₹${Math.round(abs).toLocaleString("en-IN")}`;
  return `${sign}₹${Math.round(abs)}`;
}

/** Full INR with grouping: ₹12,34,567. */
export function inrFull(value: unknown): string {
  return `₹${Math.round(toNumber(value)).toLocaleString("en-IN")}`;
}

export function initials(name?: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** "12 Jun 2026" — stable, no locale surprises. */
export function fmtDate(input?: string | number | null): string {
  if (!input) return "";
  const d = new Date(input);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

/** "3d ago", "2h ago", "just now". */
export function timeAgo(input?: string | number | null): string {
  if (!input) return "";
  const d = new Date(input);
  if (isNaN(d.getTime())) return "";
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  return fmtDate(input);
}

/** Turn snake_case / enum values into "Title Case". */
export function titleCase(s?: string | null): string {
  if (!s) return "";
  return s
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
