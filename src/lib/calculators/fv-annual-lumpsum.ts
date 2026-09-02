/**
 * Future Value of Annual Lumpsum — math engine.
 *
 * A fixed lumpsum is invested at the START of each year for the "payment period",
 * and the whole corpus compounds annually over the (longer or equal) "investment
 * period". After contributions stop, the corpus keeps growing untouched to the
 * end of the investment period. Two return scenarios can be compared.
 *
 * CONVENTION — annual compounding, contributions at year start (each year:
 * add the year's investment, then grow by the annual rate). Calibrated to the
 * reference case study to the rupee:
 *   ₹5,00,000/yr · invest 15 yrs · pay 10 yrs · 12% → ₹1,73,19,046
 *   (year-1 ₹5,60,000; contributions stop after year 10).
 */

export type FvAnnualScenarioResult = {
  ratePct: number;
  futureValue: number;
  totalInvested: number;
  wealthGain: number;
  schedule: { year: number; investment: number; yearEndValue: number }[];
};

export type FvAnnualLumpsumInput = {
  annualInvestment: number;
  investmentYears: number; // total horizon
  paymentYears: number; // years contributions are made (≤ investmentYears)
  scenario1Pct: number;
  scenario2Pct: number | null; // optional comparison
};

export type FvAnnualLumpsumResult = {
  scenario1: FvAnnualScenarioResult;
  scenario2: FvAnnualScenarioResult | null;
};

function simulate(annual: number, investYears: number, payYears: number, ratePct: number): FvAnnualScenarioResult {
  const r = ratePct / 100;
  const nInvest = Math.max(0, Math.round(investYears));
  const nPay = Math.max(0, Math.min(Math.round(payYears), nInvest));
  let corpus = 0;
  const schedule: FvAnnualScenarioResult["schedule"] = [];
  for (let y = 1; y <= nInvest; y++) {
    const investment = y <= nPay ? annual : 0;
    corpus = (corpus + investment) * (1 + r);
    schedule.push({ year: y, investment, yearEndValue: corpus });
  }
  const totalInvested = annual * nPay;
  return { ratePct, futureValue: corpus, totalInvested, wealthGain: corpus - totalInvested, schedule };
}

export function computeFvAnnualLumpsum(input: FvAnnualLumpsumInput): FvAnnualLumpsumResult {
  return {
    scenario1: simulate(input.annualInvestment, input.investmentYears, input.paymentYears, input.scenario1Pct),
    scenario2:
      input.scenario2Pct != null && input.scenario2Pct > 0
        ? simulate(input.annualInvestment, input.investmentYears, input.paymentYears, input.scenario2Pct)
        : null,
  };
}
