/**
 * Discovery — risk profiling + product suitability.
 *
 * Ported 1:1 from the firm's "Needs Discovery" workbook (Risk Score Calculator +
 * Suitability Check). Ten parameters score 1–5 → 0–50 → a six-band risk profile;
 * the band + horizon + lump-sum + liquidity drive a MF/Equity/Insurance/PMS/AIF/
 * SIF suitability matrix.
 *
 * Three of the ten parameters (age, income, net worth) are DERIVED from the
 * fact-find so the RM/client never re-keys them; the other seven behavioural
 * questions are asked in the Risk-profiling section. Pure + deterministic so it
 * runs in the browser (live recompute) and on the server (cached snapshot).
 */

/* ── question options (scored where 1–5 applies) ─────────────────────────── */
export interface RiskOption { value: string; score?: number }
export interface RiskQuestion { key: string; label: string; options: RiskOption[]; scored?: boolean; help?: string }

const s = (pairs: [string, number][]): RiskOption[] => pairs.map(([value, score]) => ({ value, score }));
const o = (...vals: string[]): RiskOption[] => vals.map((value) => ({ value }));

const HORIZON = s([["< 1 Year", 1], ["1–3 Years", 2], ["3–5 Years", 3], ["5–10 Years", 4], ["> 10 Years", 5]]);
const LIQUIDITY = s([["< 1 Week", 1], ["1–3 Months", 2], ["3–12 Months", 3], ["1–3 Years", 4], ["> 3 Years", 5]]);
const REACTION = s([["Sell Everything", 1], ["Sell Some", 2], ["Hold & Wait", 3], ["Buy More", 4], ["Buy Very Aggressively", 5]]);
const KNOWLEDGE = s([["Novice – Never invested", 1], ["Basic – FD/PPF only", 2], ["Intermediate – MF investor", 3], ["Advanced – Equity/PMS", 4], ["Expert – Derivatives/AIF", 5]]);
const EXPERIENCE = s([["Never", 1], ["Less than 1 Year", 2], ["1–3 Years", 3], ["3–5 Years", 4], ["> 5 Years", 5]]);
const PCT_RISK = s([["< 10% of Savings", 1], ["10–25%", 2], ["25–50%", 3], ["50–75%", 4], ["> 75%", 5]]);
const LOANS = s([["Yes – Major Liabilities", 1], ["Yes – Minor Liabilities", 3], ["No Loans", 5]]);
const LUMP_SUM = o("< ₹1 Lakh", "₹1–5 Lakhs", "₹5–10 Lakhs", "₹10–25 Lakhs", "₹25–50 Lakhs", "₹50L–1 Crore", "> ₹1 Crore");

/** The behavioural questions ASKED in the Risk-profiling section. (Age / income /
 *  net worth are derived from the fact-find, so they're not re-asked here.) */
export const RISK_QUESTIONS: RiskQuestion[] = [
  { key: "horizon", label: "Investment time horizon for the primary goal?", options: HORIZON, scored: true },
  { key: "lumpSum", label: "Lump-sum amount available to invest now?", options: LUMP_SUM, help: "Drives PMS / AIF / SIF eligibility" },
  { key: "liquidity", label: "When might the client need to access this money?", options: LIQUIDITY, scored: true },
  { key: "reaction", label: "If the portfolio fell 20% in 3 months, the client would:", options: REACTION, scored: true },
  { key: "knowledge", label: "Investment knowledge level?", options: KNOWLEDGE, scored: true },
  { key: "experience", label: "Prior capital-market experience?", options: EXPERIENCE, scored: true },
  { key: "pctRisk", label: "% of total savings willing to put at risk?", options: PCT_RISK, scored: true },
  { key: "loans", label: "Outstanding loans or liabilities?", options: LOANS, scored: true },
];

/* ── bands (workbook thresholds on a 0–50 scale) ─────────────────────────── */
export type RiskBandId = "conservative" | "moderately_conservative" | "moderate" | "moderately_aggressive" | "aggressive" | "very_aggressive";
export interface RiskBand { id: RiskBandId; label: string; max: number; color: string; products: string }

export const RISK_BANDS: RiskBand[] = [
  { id: "conservative", label: "Conservative", max: 17, color: "#0e7490", products: "Debt MF, Liquid MF, Insurance, FD" },
  { id: "moderately_conservative", label: "Moderately Conservative", max: 25, color: "#0891b2", products: "Balanced MF, Insurance, Large Cap MF" },
  { id: "moderate", label: "Moderate", max: 33, color: "#16a34a", products: "Hybrid MF, Balanced Advantage Fund, select PMS" },
  { id: "moderately_aggressive", label: "Moderately Aggressive", max: 40, color: "#ca8a04", products: "Equity MF, PMS, SIF" },
  { id: "aggressive", label: "Aggressive", max: 47, color: "#ea580c", products: "Direct Equity, PMS, AIF, SIF" },
  { id: "very_aggressive", label: "Very Aggressive", max: 50, color: "#dc2626", products: "Direct Equity, AIF Cat III, International" },
];
export const MAX_RISK_SCORE = 50;

export const bandForScore = (total: number): RiskBand => RISK_BANDS.find((b) => total <= b.max) ?? RISK_BANDS[RISK_BANDS.length - 1];

/** Map to the app's canonical 4-band category (investors.riskProfile). */
export function toCanonicalCategory(band: RiskBandId): "conservative" | "moderate" | "aggressive" | "very_aggressive" {
  if (band === "conservative" || band === "moderately_conservative") return "conservative";
  if (band === "moderate") return "moderate";
  if (band === "very_aggressive") return "very_aggressive";
  return "aggressive";
}

/* ── derive the 3 fact-find parameters → 1–5 ─────────────────────────────── */
const L = 100_000, CR = 10_000_000;
export const ageScore = (age: number | null): number | null => {
  if (age == null || !Number.isFinite(age) || age <= 0) return null;
  if (age <= 35) return 5; if (age <= 45) return 4; if (age <= 55) return 3; if (age <= 65) return 2; return 1;
};
export const incomeScore = (gross: number): number | null => {
  if (!gross || gross <= 0) return null;
  if (gross < 5 * L) return 1; if (gross < 10 * L) return 2; if (gross < 25 * L) return 3; if (gross < 50 * L) return 4; return 5;
};
export const netWorthScore = (nw: number, known: boolean): number | null => {
  if (!known) return null;
  if (nw < 25 * L) return 1; if (nw < 50 * L) return 2; if (nw < CR) return 3; if (nw < 5 * CR) return 4; return 5;
};

/* ── product suitability (Suitability Check sheet) ───────────────────────── */
export type Verdict = "yes" | "maybe" | "no" | "na";
export const PRODUCTS = ["mf", "equity", "insurance", "pms", "aif", "sif"] as const;
export type ProductKey = (typeof PRODUCTS)[number];
export const PRODUCT_LABELS: Record<ProductKey, string> = {
  mf: "Mutual Funds", equity: "Direct Equity", insurance: "Insurance (Life/ULIP)", pms: "PMS", aif: "AIF", sif: "SIF",
};

type RiskShort = "Conservative" | "Mod. Conservative" | "Moderate" | "Mod. Aggressive" | "Aggressive" | "Very Aggressive";
type LiquidityNeed = "High" | "Moderate" | "Low" | "Very Low";
const riskShort = (b: RiskBandId): RiskShort =>
  ({ conservative: "Conservative", moderately_conservative: "Mod. Conservative", moderate: "Moderate", moderately_aggressive: "Mod. Aggressive", aggressive: "Aggressive", very_aggressive: "Very Aggressive" } as const)[b];
const liquidityNeed = (b8: string): LiquidityNeed | "" => {
  if (b8 === "< 1 Week") return "High";
  if (b8 === "1–3 Months" || b8 === "3–12 Months") return "Moderate";
  if (b8 === "1–3 Years") return "Low";
  if (b8 === "> 3 Years") return "Very Low";
  return "";
};
const v = (yes: boolean, maybe: boolean): Verdict => (yes ? "yes" : maybe ? "maybe" : "no");

function byRisk(r: RiskShort, p: ProductKey): Verdict {
  const aggr = r === "Mod. Aggressive" || r === "Aggressive" || r === "Very Aggressive";
  switch (p) {
    case "mf": return "yes";
    case "equity": return v(aggr, r === "Moderate");
    case "insurance": return v(r === "Conservative" || r === "Mod. Conservative" || r === "Moderate", true);
    case "pms": return v(aggr, r === "Moderate");
    case "aif": return v(r === "Aggressive" || r === "Very Aggressive", r === "Mod. Aggressive");
    case "sif": return v(aggr, r === "Moderate");
  }
}
function byHorizon(h: string, p: ProductKey): Verdict {
  const mid = h === "3–5 Years" || h === "5–10 Years" || h === "> 10 Years";
  const long = h === "5–10 Years" || h === "> 10 Years";
  switch (p) {
    case "mf": return "yes";
    case "equity": return v(mid, h === "1–3 Years");
    case "insurance": return v(long, h === "3–5 Years");
    case "pms": return v(mid, h === "1–3 Years");
    case "aif": return v(long, h === "3–5 Years");
    case "sif": return v(mid, true);
  }
}
function bySurplus(su: string, p: ProductKey): Verdict {
  const has = (...xs: string[]) => xs.includes(su);
  switch (p) {
    case "mf": return "yes";
    case "equity": return v(su !== "< ₹1 Lakh", true);
    case "insurance": return "yes";
    case "pms": return v(has("₹25–50 Lakhs", "₹50L–1 Crore", "> ₹1 Crore"), has("₹10–25 Lakhs"));
    case "aif": return v(has("> ₹1 Crore"), has("₹50L–1 Crore"));
    case "sif": return v(has("₹10–25 Lakhs", "₹25–50 Lakhs", "₹50L–1 Crore", "> ₹1 Crore"), has("₹5–10 Lakhs"));
  }
}
function byLiquidity(l: LiquidityNeed, p: ProductKey): Verdict {
  const okMid = l === "Moderate" || l === "Low" || l === "Very Low";
  const lowish = l === "Low" || l === "Very Low";
  switch (p) {
    case "mf": return "yes";
    case "equity": return v(okMid, true);
    case "insurance": return v(lowish, l === "Moderate");
    case "pms": return v(lowish, l === "Moderate");
    case "aif": return v(l === "Very Low", l === "Low");
    case "sif": return v(lowish, true);
  }
}
function rollup(cells: Verdict[]): Verdict {
  const live = cells.filter((c) => c !== "na");
  if (!live.length) return "na";
  if (live.includes("no")) return "no";
  if (live.includes("maybe")) return "maybe";
  return "yes";
}

export interface SuitabilityCell { risk: Verdict; horizon: Verdict; surplus: Verdict; liquidity: Verdict; overall: Verdict }
export type SuitabilityMatrix = Record<ProductKey, SuitabilityCell>;

/* ── the orchestrator ────────────────────────────────────────────────────── */
export interface RiskInput {
  answers: Record<string, string>; // data.riskProfile (the 8 asked fields)
  age: number | null;
  grossAnnualIncome: number;
  netWorth: number;
  netWorthKnown: boolean;
}
export interface RiskResult {
  score: number;
  max: number;
  answered: number;
  total: number; // # of scored params (10)
  complete: boolean;
  bandId: RiskBandId;
  bandLabel: string;
  bandColor: string;
  bandProducts: string;
  category: "conservative" | "moderate" | "aggressive" | "very_aggressive";
  suitability: SuitabilityMatrix;
  suitabilityReady: boolean;
}

export function computeRisk(inp: RiskInput): RiskResult {
  const a = inp.answers ?? {};
  let score = 0;
  let answered = 0;

  // 7 asked-and-scored questions
  for (const q of RISK_QUESTIONS) {
    if (!q.scored) continue;
    const val = a[q.key] ?? "";
    const sc = q.options.find((x) => x.value === val)?.score ?? 0;
    if (val) answered++;
    score += sc;
  }
  // 3 derived-and-scored parameters
  const age = ageScore(inp.age);
  const inc = incomeScore(inp.grossAnnualIncome);
  const nw = netWorthScore(inp.netWorth, inp.netWorthKnown);
  for (const d of [age, inc, nw]) {
    if (d != null) { answered++; score += d; }
  }

  const band = bandForScore(score);

  // suitability inputs
  const r = riskShort(band.id);
  const h = a.horizon ?? "";
  const su = a.lumpSum ?? "";
  const l = liquidityNeed(a.liquidity ?? "");
  const matrix = {} as SuitabilityMatrix;
  for (const p of PRODUCTS) {
    const risk = byRisk(r, p);
    const horizon = h ? byHorizon(h, p) : "na";
    const surplus = su ? bySurplus(su, p) : "na";
    const liquidity = l ? byLiquidity(l, p) : "na";
    matrix[p] = { risk, horizon, surplus, liquidity, overall: rollup([risk, horizon, surplus, liquidity]) };
  }

  return {
    score,
    max: MAX_RISK_SCORE,
    answered,
    total: 10,
    complete: answered === 10,
    bandId: band.id,
    bandLabel: band.label,
    bandColor: band.color,
    bandProducts: band.products,
    category: toCanonicalCategory(band.id),
    suitability: matrix,
    suitabilityReady: answered > 0,
  };
}
