/**
 * The Journey to Freedom (EFP workbook).
 *
 * You invest your monthly surplus (salary − expenses). Each year the corpus
 * grows; for every year we ask "if you stopped earning now, how many years
 * would this corpus sustain your inflating expenses?" The first year the corpus
 * sustains them *forever* (its real growth covers the withdrawal) is Financial
 * Freedom.
 *
 * Faithful to the workbook (matches to the rupee):
 *   corpus(n) = annuity-due FV of the monthly investment at the effective→monthly
 *               rate ((1+r)^(1/12)−1, i.e. NOMINAL(r,12)/12).
 *   years-of-freedom = Excel NPER(realRate, annualExpense, −corpus, , 1) where
 *               realRate = (1+r)/(1+inflation) − 1; it "errors" (→ ∞ / Freedom)
 *               once the corpus reaches the perpetuity threshold.
 */

export type JourneyYear = {
  year: number;
  corpus: number;
  yearsOfFreedom: number; // Infinity once freedom is reached
  freedom: boolean;
};

export type JourneyResult = {
  investmentMonthly: number;
  annualExpense: number;
  realRatePct: number;
  freedomCorpus: number; // annuity-due perpetuity threshold
  freedomYear: number | null; // first year of Financial Freedom (null if not within maxYears)
  corpusAtFreedom: number | null;
  rows: JourneyYear[];
};

export function journeyToFreedom(input: {
  salaryMonthly: number;
  expensesMonthly: number;
  inflationPct: number;
  returnPct: number;
  maxYears?: number;
}): JourneyResult {
  const maxYears = Math.max(1, Math.round(input.maxYears ?? 30));
  const investment = Math.max(0, input.salaryMonthly - input.expensesMonthly);
  const annualExpense = Math.max(0, input.expensesMonthly) * 12;
  const m = Math.pow(1 + input.returnPct / 100, 1 / 12) - 1; // effective → monthly
  const realRate = (1 + input.returnPct / 100) / (1 + input.inflationPct / 100) - 1;

  const freedomCorpus =
    realRate > 0 ? (annualExpense * (1 + realRate)) / realRate : Number.POSITIVE_INFINITY;

  const corpusAt = (n: number) =>
    investment <= 0 || m === 0
      ? investment * n * 12
      : investment * ((Math.pow(1 + m, n * 12) - 1) / m) * (1 + m);

  /** Annuity-due NPER — how many years `corpus` lasts; Infinity once perpetual. */
  const yearsLast = (corpus: number): number => {
    if (corpus <= 0) return 0;
    if (realRate <= 0) return annualExpense > 0 ? corpus / annualExpense : Number.POSITIVE_INFINITY;
    const denom = annualExpense * (1 + realRate) - corpus * realRate;
    if (denom <= 0) return Number.POSITIVE_INFINITY;
    const x = (annualExpense * (1 + realRate)) / denom;
    if (x <= 0) return Number.POSITIVE_INFINITY;
    return Math.log(x) / Math.log(1 + realRate);
  };

  const rows: JourneyYear[] = [];
  let freedomYear: number | null = null;
  let corpusAtFreedom: number | null = null;
  for (let n = 1; n <= maxYears; n++) {
    const corpus = corpusAt(n);
    const yof = yearsLast(corpus);
    const freedom = !Number.isFinite(yof);
    if (freedom && freedomYear === null) {
      freedomYear = n;
      corpusAtFreedom = corpus;
    }
    rows.push({ year: n, corpus, yearsOfFreedom: yof, freedom });
  }

  return {
    investmentMonthly: investment,
    annualExpense,
    realRatePct: realRate * 100,
    freedomCorpus,
    freedomYear,
    corpusAtFreedom,
    rows,
  };
}
