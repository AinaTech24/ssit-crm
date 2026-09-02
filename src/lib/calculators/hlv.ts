/**
 * Human Life Value (HLV) — math engine.
 *
 * Income Replacement Method: the term cover needed to replace the present value
 * of a person's future income stream (growing with annual increments) until
 * retirement, discounting future income to today. Optionally net of the
 * person's own personal expenses (self-consumption).
 *
 * Verified to the reference case (Mr. Shukla: income ₹15L, own expense ₹3L,
 * increment 8%, discount 6%, 30 years): PV of future income = ₹5.64 cr; with an
 * existing ₹1 cr cover → ₹4.64 cr additional cover required.
 *
 * Also provides a standard Need Analysis Method (liabilities + future goals +
 * PV of the family's ongoing expenses − existing assets − existing cover).
 */

export type HlvMethod = "income_replacement" | "need_analysis";
export type CoverBasis = "gross" | "net";

/**
 * PV of a growing annuity — first payment P at the end of year 1, growing at
 * `growthPct`/yr, discounted at `discountPct`/yr, for `years` years. Works for
 * growth > discount (the PV factor just gets large). Closed form with a
 * degenerate-rate guard.
 */
export function pvGrowingAnnuity(P: number, growthPct: number, discountPct: number, years: number): number {
  if (P <= 0 || years <= 0) return 0;
  const g = growthPct / 100;
  const r = discountPct / 100;
  if (Math.abs(r - g) < 1e-9) return (P * years) / (1 + r);
  return (P * (1 - Math.pow((1 + g) / (1 + r), years))) / (r - g);
}

/* ───────────────────────── Income Replacement ───────────────────────── */

export type IncomeReplacementInput = {
  currentAge: number;
  retirementAge: number;
  discountPct: number;
  currentAnnualIncome: number;
  annualPersonalExpenses: number;
  incrementPct: number;
  existingCover: number;
};

export type IncomeReplacementResult = {
  years: number;
  pvIncome: number;
  pvExpenses: number;
  hlvGross: number; // = pvIncome
  hlvNet: number; // pvIncome − pvExpenses
  additionalGross: number;
  additionalNet: number;
};

export function computeIncomeReplacement(input: IncomeReplacementInput): IncomeReplacementResult {
  const years = Math.max(0, Math.round(input.retirementAge - input.currentAge));
  const pvIncome = pvGrowingAnnuity(input.currentAnnualIncome, input.incrementPct, input.discountPct, years);
  const pvExpenses = pvGrowingAnnuity(input.annualPersonalExpenses, input.incrementPct, input.discountPct, years);
  const hlvGross = pvIncome;
  const hlvNet = Math.max(0, pvIncome - pvExpenses);
  return {
    years,
    pvIncome,
    pvExpenses,
    hlvGross,
    hlvNet,
    additionalGross: Math.max(0, hlvGross - input.existingCover),
    additionalNet: Math.max(0, hlvNet - input.existingCover),
  };
}

/* ───────────────────────── Need Analysis ───────────────────────── */

export type NeedAnalysisInput = {
  outstandingLiabilities: number; // loans to clear
  futureGoals: number; // children education / marriage etc (today's lump)
  familyAnnualNeed: number; // ongoing family expense to sustain
  yearsOfSupport: number;
  incrementPct: number; // family need grows with inflation
  discountPct: number;
  existingAssets: number; // investments / savings that offset the need
  existingCover: number;
};

export type NeedAnalysisResult = {
  pvFamilyNeed: number;
  totalNeed: number; // liabilities + goals + pvFamilyNeed
  offsets: number; // assets + existing cover
  coverRequired: number;
};

export function computeNeedAnalysis(input: NeedAnalysisInput): NeedAnalysisResult {
  const pvFamilyNeed = pvGrowingAnnuity(input.familyAnnualNeed, input.incrementPct, input.discountPct, Math.max(0, Math.round(input.yearsOfSupport)));
  const totalNeed = input.outstandingLiabilities + input.futureGoals + pvFamilyNeed;
  const offsets = input.existingAssets + input.existingCover;
  return {
    pvFamilyNeed,
    totalNeed,
    offsets,
    coverRequired: Math.max(0, totalNeed - offsets),
  };
}
