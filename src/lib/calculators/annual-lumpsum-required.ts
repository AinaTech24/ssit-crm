/**
 * Annual Lumpsum Required for a Target Future Value — math engine.
 *
 * The inverse of the FV-of-annual-lumpsum problem: given a target corpus, how
 * much must be invested as a lumpsum each year (for the payment period) so the
 * corpus — compounding over the investment period — reaches the target. Up to
 * two return scenarios are compared.
 *
 * CONVENTION (matches the FV Annual Lumpsum engine): annual compounding,
 * contributions at the START of each year; after the payment period ends the
 * corpus keeps growing untouched to the end of the investment period. Verified
 * to the reference case (₹25,00,000 target, 10y invest = 10y pay, 12% →
 * ₹1,27,197 required annually; factor 19.6546).
 */

/** FV (per ₹1 of annual investment) of investing ₹1/yr at each year start for
 *  `payYears`, compounding over `investYears` total. */
export function annualLumpsumFactor(investYears: number, payYears: number, ratePct: number): number {
  const r = ratePct / 100;
  const nInvest = Math.max(0, Math.round(investYears));
  const nPay = Math.max(0, Math.min(Math.round(payYears), nInvest));
  let factor = 0;
  for (let t = 1; t <= nPay; t++) factor += Math.pow(1 + r, nInvest - t + 1);
  return factor;
}

export type RequiredScenario = {
  ratePct: number;
  requiredAnnual: number;
  totalInvested: number;
  wealthGain: number;
  schedule: { year: number; investment: number; yearEndValue: number }[];
};

export type AnnualLumpsumRequiredInput = {
  targetAmount: number;
  investmentYears: number;
  paymentYears: number;
  scenario1Pct: number;
  scenario2Pct: number | null;
};

export type AnnualLumpsumRequiredResult = {
  scenario1: RequiredScenario;
  scenario2: RequiredScenario | null;
};

function buildScenario(input: AnnualLumpsumRequiredInput, ratePct: number): RequiredScenario {
  const nInvest = Math.max(0, Math.round(input.investmentYears));
  const nPay = Math.max(0, Math.min(Math.round(input.paymentYears), nInvest));
  const factor = annualLumpsumFactor(nInvest, nPay, ratePct);
  const requiredAnnual = factor > 0 ? input.targetAmount / factor : 0;
  const r = ratePct / 100;

  // Year-by-year accumulation schedule (contribution at year start, then grow).
  const schedule: RequiredScenario["schedule"] = [];
  let value = 0;
  for (let y = 1; y <= nInvest; y++) {
    const investment = y <= nPay ? requiredAnnual : 0;
    value = (value + investment) * (1 + r);
    schedule.push({ year: y, investment, yearEndValue: value });
  }

  const totalInvested = requiredAnnual * nPay;
  return {
    ratePct,
    requiredAnnual,
    totalInvested,
    wealthGain: Math.max(0, input.targetAmount - totalInvested),
    schedule,
  };
}

export function computeAnnualLumpsumRequired(input: AnnualLumpsumRequiredInput): AnnualLumpsumRequiredResult {
  return {
    scenario1: buildScenario(input, input.scenario1Pct),
    scenario2: input.scenario2Pct != null && input.scenario2Pct > 0 ? buildScenario(input, input.scenario2Pct) : null,
  };
}
