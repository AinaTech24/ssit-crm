/**
 * NPS Retirement & Tax — math engine.
 *
 * Projects the National Pension System corpus at retirement from monthly
 * contributions (optionally stepped up yearly) plus any existing corpus, then
 * splits it into the tax-free lump sum (up to 60%) and the mandatory annuity
 * (≥ 40%), and estimates the monthly pension. Also shows the 80CCD(1B) tax
 * benefit (extra ₹50,000 deduction over 80C).
 *
 * Convention: effective monthly rate, contributions at month start (begin
 * mode), annual step-up applied each year.
 */

import { monthlyRate } from "./sip360";

export type NpsInput = {
  currentAge: number;
  retirementAge: number;
  monthlyContribution: number;
  annualStepUpPct: number;
  expectedReturnPct: number;
  existingCorpus: number;
  annuityPortionPct: number; // ≥ 40
  annuityRatePct: number; // pension rate on the annuity corpus
  taxSlabPct: number; // for the 80CCD(1B) benefit
};

export type NpsResult = {
  years: number;
  corpus: number;
  totalContributed: number;
  lumpSum: number; // tax-free withdrawal
  annuityCorpus: number;
  monthlyPension: number;
  annual80CCD1BBenefit: number; // tax saved this year on the extra ₹50k
};

export function computeNps(input: NpsInput): NpsResult {
  const years = Math.max(0, Math.round(input.retirementAge - input.currentAge));
  const m = monthlyRate(input.expectedReturnPct);

  // Stepped-up monthly contributions, begin mode, month-granular.
  let corpus = input.existingCorpus * Math.pow(1 + m, years * 12);
  let totalContributed = 0;
  let monthly = input.monthlyContribution;
  for (let y = 0; y < years; y++) {
    if (y > 0) monthly *= 1 + input.annualStepUpPct / 100;
    for (let mo = 0; mo < 12; mo++) {
      const monthsRemaining = (years - y) * 12 - mo;
      corpus += monthly * Math.pow(1 + m, monthsRemaining);
      totalContributed += monthly;
    }
  }

  const annuityPortion = Math.min(100, Math.max(40, input.annuityPortionPct)) / 100;
  const annuityCorpus = corpus * annuityPortion;
  const lumpSum = corpus - annuityCorpus;
  const monthlyPension = (annuityCorpus * (input.annuityRatePct / 100)) / 12;
  const annual80CCD1BBenefit = 50000 * (input.taxSlabPct / 100);

  return {
    years,
    corpus,
    totalContributed,
    lumpSum,
    annuityCorpus,
    monthlyPension,
    annual80CCD1BBenefit,
  };
}
