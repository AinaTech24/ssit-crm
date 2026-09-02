/**
 * Property Rental Yield & Reinvestment — math engine.
 *
 * Shows the *true* return on a property by combining three things an
 * "appreciation only" view misses:
 *   1. capital appreciation of the property,
 *   2. the net monthly rental surplus (rent − maintenance), and
 *   3. the wealth created when that surplus is reinvested as a SIP.
 *
 * The headline is the blended "Overall Yield" — the CAGR that turns today's
 * property value into the combined (property + reinvested-surplus) wealth.
 *
 * CONVENTIONS — calibrated to reproduce the reference case study to the rupee:
 *   Property : annual compounding,  value_t = V0 · (1 + appreciation)^t.
 *   SIP      : the investible surplus is reinvested monthly and STEPS UP each
 *              year by the rent/expense increment (the surplus grows as rent
 *              grows); EFFECTIVE monthly rate m = (1+a)^(1/12)−1, BEGIN-mode.
 *
 *   Worked example (₹1 Cr · 5% appreciation · ₹30,000 rent − ₹2,500 maintenance
 *   = ₹27,500 surplus · 3% increment · 12% SIP return · 10 years):
 *     property = ₹1,62,88,946 · SIP = ₹68,73,075 · total = ₹2,31,62,021 ·
 *     overall yield = 8.76%.
 */

export type PropertyYieldInput = {
  marketValue: number;
  appreciationPct: number;
  monthlyRent: number;
  monthlyMaintenance: number;
  annualIncrementPct: number; // rent & expenses increment — also steps up the SIP
  investibleSurplus: number; // starting monthly amount reinvested (defaults to rent − maintenance)
  sipReturnPct: number;
  years: number;
};

export type PropertyYieldYearRow = {
  year: number;
  propertyValue: number;
  monthlySurplusThatYear: number;
  surplusInvestedThisYear: number;
  sipCorpus: number;
  combined: number;
};

export type PropertyYieldResult = {
  netMonthlySurplus: number;
  futurePropertyValue: number;
  propertyGain: number;
  sipValue: number;
  totalInvestedSurplus: number;
  sipGain: number;
  totalCombined: number;
  overallYieldPct: number;
  propertyOnlyCagrPct: number;
  annualRentalYieldPct: number; // first-year net rent ÷ market value
  schedule: PropertyYieldYearRow[];
};

const effM = (annualPct: number) => Math.pow(1 + annualPct / 100, 1 / 12) - 1;

export function computePropertyYield(input: PropertyYieldInput): PropertyYieldResult {
  const years = Math.max(0, Math.round(input.years));
  const netMonthlySurplus = Math.max(0, input.monthlyRent - input.monthlyMaintenance);
  const startSurplus = input.investibleSurplus;
  const m = effM(input.sipReturnPct);
  const s = input.annualIncrementPct / 100;
  const appr = input.appreciationPct / 100;

  let sipCorpus = 0;
  let totalInvested = 0;
  const schedule: PropertyYieldYearRow[] = [];

  for (let y = 0; y < years; y++) {
    const monthly = startSurplus * Math.pow(1 + s, y);
    let investedThisYear = 0;
    for (let mo = 0; mo < 12; mo++) {
      // Begin-mode: add the contribution, then grow the whole balance.
      sipCorpus = (sipCorpus + monthly) * (1 + m);
      totalInvested += monthly;
      investedThisYear += monthly;
    }
    const propertyValue = input.marketValue * Math.pow(1 + appr, y + 1);
    schedule.push({
      year: y + 1,
      propertyValue,
      monthlySurplusThatYear: monthly,
      surplusInvestedThisYear: investedThisYear,
      sipCorpus,
      combined: propertyValue + sipCorpus,
    });
  }

  const futurePropertyValue = input.marketValue * Math.pow(1 + appr, years);
  const sipValue = sipCorpus;
  const totalCombined = futurePropertyValue + sipValue;
  const overallYieldPct =
    input.marketValue > 0 && years > 0
      ? (Math.pow(totalCombined / input.marketValue, 1 / years) - 1) * 100
      : 0;

  return {
    netMonthlySurplus,
    futurePropertyValue,
    propertyGain: futurePropertyValue - input.marketValue,
    sipValue,
    totalInvestedSurplus: totalInvested,
    sipGain: sipValue - totalInvested,
    totalCombined,
    overallYieldPct,
    propertyOnlyCagrPct: input.appreciationPct,
    annualRentalYieldPct: input.marketValue > 0 ? (netMonthlySurplus * 12 * 100) / input.marketValue : 0,
    schedule,
  };
}
