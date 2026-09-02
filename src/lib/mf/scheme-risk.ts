/**
 * Derive a scheme's SEBI riskometer band from its category/name.
 *
 * mfapi.in / AMFI don't expose the official riskometer, but the SEBI risk band
 * maps very closely to the scheme category, so we infer it. Best-effort — shown
 * as guidance next to the scheme name; the scheme document remains authoritative.
 *
 * Bands (SEBI): 1 Low · 2 Low to Moderate · 3 Moderate · 4 Moderately High ·
 * 5 High · 6 Very High.
 */

export type SchemeRisk = { band: number; label: string; tone: string };

const LABELS: Record<number, string> = {
  1: "Low",
  2: "Low to Moderate",
  3: "Moderate",
  4: "Moderately High",
  5: "High",
  6: "Very High",
};

// Tailwind chip classes per band (green → red).
const TONES: Record<number, string> = {
  1: "bg-emerald-50 text-emerald-700 border-emerald-200",
  2: "bg-teal-50 text-teal-700 border-teal-200",
  3: "bg-amber-50 text-amber-700 border-amber-200",
  4: "bg-orange-50 text-orange-700 border-orange-200",
  5: "bg-rose-50 text-rose-700 border-rose-200",
  6: "bg-red-100 text-red-700 border-red-300",
};

// Ordered keyword rules — first match wins. Lowest-risk / most-specific first so
// e.g. "aggressive hybrid" resolves before the broad "equity" catch-all.
const RULES: Array<{ re: RegExp; band: number }> = [
  { re: /overnight/i, band: 1 },
  { re: /liquid/i, band: 1 },
  { re: /money\s*market|ultra[\s-]*short|low\s*duration|short\s*duration|arbitrage/i, band: 2 },
  { re: /conservative\s*hybrid|banking\s*(and|&|\+)?\s*psu|corporate\s*bond|floater|medium\s*(to\s*long\s*)?duration|dynamic\s*bond|gilt|constant\s*maturity|debt/i, band: 3 },
  { re: /balanced\s*advantage|dynamic\s*asset|equity\s*savings|multi[\s-]*asset|gold|silver/i, band: 4 },
  { re: /aggressive\s*hybrid|credit\s*risk/i, band: 5 },
  { re: /equity|elss|tax\s*saver|large\s*cap|large\s*&?\s*mid|mid\s*cap|small\s*cap|flexi\s*cap|multi\s*cap|focused|value|contra|dividend\s*yield|sector|thematic|index|nifty|sensex|international|global|overseas|fof|fund\s*of\s*funds|hybrid/i, band: 6 },
];

export function deriveSchemeRisk(category?: string | null, name?: string | null): SchemeRisk | null {
  const hay = `${category ?? ""} ${name ?? ""}`.trim();
  if (!hay) return null;
  for (const r of RULES) {
    if (r.re.test(hay)) return { band: r.band, label: LABELS[r.band], tone: TONES[r.band] };
  }
  return null;
}
