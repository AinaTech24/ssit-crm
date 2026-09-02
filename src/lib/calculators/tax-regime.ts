/**
 * Old vs New Tax Regime Optimizer — math engine (FY 2025-26 / AY 2026-27).
 *
 * Computes income tax under both regimes from gross income and deductions, then
 * shows which is cheaper, the saving, and the SIP that saving could fund.
 *
 * Slabs & rules used (individual < 60):
 *  NEW: 0-4L nil, 4-8L 5%, 8-12L 10%, 12-16L 15%, 16-20L 20%, 20-24L 25%,
 *       >24L 30%; std deduction ₹75,000; 87A full rebate if taxable ≤ ₹12L
 *       (rebate cap ₹60,000); surcharge capped at 25%.
 *  OLD: 0-2.5L nil, 2.5-5L 5%, 5-10L 20%, >10L 30%; std deduction ₹50,000;
 *       87A rebate if taxable ≤ ₹5L (cap ₹12,500); deductions allowed.
 *  Both: 4% health & education cess; surcharge 10/15/25/37% by income band.
 */

export type Slab = { upTo: number; rate: number }; // rate as fraction; upTo = Infinity for top

const NEW_SLABS: Slab[] = [
  { upTo: 400000, rate: 0 },
  { upTo: 800000, rate: 0.05 },
  { upTo: 1200000, rate: 0.10 },
  { upTo: 1600000, rate: 0.15 },
  { upTo: 2000000, rate: 0.20 },
  { upTo: 2400000, rate: 0.25 },
  { upTo: Infinity, rate: 0.30 },
];

const OLD_SLABS: Slab[] = [
  { upTo: 250000, rate: 0 },
  { upTo: 500000, rate: 0.05 },
  { upTo: 1000000, rate: 0.20 },
  { upTo: Infinity, rate: 0.30 },
];

export function slabTax(taxable: number, slabs: Slab[]): number {
  let tax = 0;
  let lower = 0;
  for (const s of slabs) {
    if (taxable > lower) {
      const upper = Math.min(taxable, s.upTo);
      tax += (upper - lower) * s.rate;
      lower = s.upTo;
    } else break;
  }
  return tax;
}

function surchargeRate(totalIncome: number, isNew: boolean): number {
  if (totalIncome <= 5000000) return 0;
  if (totalIncome <= 10000000) return 0.10;
  if (totalIncome <= 20000000) return 0.15;
  if (totalIncome <= 50000000) return 0.25;
  return isNew ? 0.25 : 0.37; // new regime caps at 25%
}

export type RegimeDeductions = {
  section80C: number; // max 1.5L
  section80D: number; // health insurance
  nps80CCD1B: number; // max 50k
  homeLoanInterest: number; // max 2L (self-occupied)
  hraExemption: number;
  otherDeductions: number;
  employerNps80CCD2: number; // allowed in BOTH regimes
};

export type RegimeResult = {
  taxableIncome: number;
  baseTax: number;
  rebate: number;
  surcharge: number;
  cess: number;
  totalTax: number;
};

const STD_DED_NEW = 75000;
const STD_DED_OLD = 50000;

function computeRegime(
  grossIncome: number,
  isSalaried: boolean,
  isNew: boolean,
  d: RegimeDeductions
): RegimeResult {
  const stdDed = isSalaried ? (isNew ? STD_DED_NEW : STD_DED_OLD) : 0;

  let taxable: number;
  if (isNew) {
    // New regime: only standard deduction + employer NPS (80CCD2).
    taxable = Math.max(0, grossIncome - stdDed - d.employerNps80CCD2);
  } else {
    const cappedDeductions =
      Math.min(d.section80C, 150000) +
      d.section80D +
      Math.min(d.nps80CCD1B, 50000) +
      Math.min(d.homeLoanInterest, 200000) +
      d.hraExemption +
      d.otherDeductions +
      d.employerNps80CCD2;
    taxable = Math.max(0, grossIncome - stdDed - cappedDeductions);
  }

  const baseTax = slabTax(taxable, isNew ? NEW_SLABS : OLD_SLABS);

  // 87A rebate.
  let rebate = 0;
  if (isNew && taxable <= 1200000) rebate = Math.min(baseTax, 60000);
  if (!isNew && taxable <= 500000) rebate = Math.min(baseTax, 12500);

  const taxAfterRebate = Math.max(0, baseTax - rebate);
  const surcharge = taxAfterRebate * surchargeRate(taxable, isNew);
  const cess = (taxAfterRebate + surcharge) * 0.04;
  const totalTax = taxAfterRebate + surcharge + cess;

  return { taxableIncome: taxable, baseTax, rebate, surcharge, cess, totalTax };
}

export type RegimeInput = {
  grossIncome: number;
  isSalaried: boolean;
  deductions: RegimeDeductions;
  /** For the "invest the saving" projection. */
  sipReturnPct: number;
  sipYears: number;
};

export type RegimeComparison = {
  old: RegimeResult;
  new: RegimeResult;
  betterRegime: "old" | "new";
  annualSaving: number;
  monthlyFromSaving: number;
  sipFutureValue: number;
};

export function compareRegimes(input: RegimeInput): RegimeComparison {
  const oldR = computeRegime(input.grossIncome, input.isSalaried, false, input.deductions);
  const newR = computeRegime(input.grossIncome, input.isSalaried, true, input.deductions);
  const betterRegime = newR.totalTax <= oldR.totalTax ? "new" : "old";
  const annualSaving = Math.abs(oldR.totalTax - newR.totalTax);
  const monthlyFromSaving = annualSaving / 12;

  // FV of investing the monthly saving (effective monthly, begin mode).
  const m = Math.pow(1 + input.sipReturnPct / 100, 1 / 12) - 1;
  const months = Math.max(0, Math.round(input.sipYears * 12));
  const sipFutureValue = m === 0
    ? monthlyFromSaving * months
    : monthlyFromSaving * ((Math.pow(1 + m, months) - 1) / m) * (1 + m);

  return { old: oldR, new: newR, betterRegime, annualSaving, monthlyFromSaving, sipFutureValue };
}
