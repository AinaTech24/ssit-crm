/**
 * Goal-planning math — a faithful RN port of src/lib/goal-planning/calc.ts.
 * Pure formulas, no DB / no React. SIPs are annuity-DUE (month-START, note the
 * trailing ×(1+m)); the 0% case is the linear limit. Keep these IN SYNC with the
 * server so on-screen numbers match the saved goal (the live calculator uses the
 * RAW expected return; the server applies the glide path — a small, intentional
 * difference, same as web).
 */

export const DEFAULT_EXPECTED_RETURN_PCT = 12;
export const DEFAULT_INFLATION_PCT = 6;

export function inflatedTarget(presentTarget: number, inflationPct: number, years: number): number {
  return presentTarget * Math.pow(1 + inflationPct / 100, years);
}

export function fvLumpsum(pv: number, annualReturnPct: number, months: number): number {
  const m = annualReturnPct / 100 / 12;
  return pv * Math.pow(1 + m, months);
}

export function fvSip(monthlySip: number, annualReturnPct: number, months: number): number {
  if (monthlySip <= 0 || months <= 0) return 0;
  const m = annualReturnPct / 100 / 12;
  if (m === 0) return monthlySip * months;
  return monthlySip * ((Math.pow(1 + m, months) - 1) / m) * (1 + m);
}

export function requiredSip(target: number, currentValue: number, annualReturnPct: number, months: number): number {
  if (months <= 0) return 0;
  const m = annualReturnPct / 100 / 12;
  const lumpFV = fvLumpsum(currentValue, annualReturnPct, months);
  const shortfall = Math.max(0, target - lumpFV);
  if (shortfall === 0) return 0;
  if (m === 0) return shortfall / months;
  return (shortfall * m) / ((Math.pow(1 + m, months) - 1) * (1 + m));
}

export function requiredLumpsumToday(target: number, annualReturnPct: number, months: number): number {
  if (months <= 0) return target;
  return target / Math.pow(1 + annualReturnPct / 100 / 12, months);
}

export function fvStepUpSip(initialMonthly: number, annualReturnPct: number, months: number, stepUpPct: number): number {
  if (initialMonthly <= 0 || months <= 0) return 0;
  const m = annualReturnPct / 100 / 12;
  const s = stepUpPct / 100;
  const fullYears = Math.floor(months / 12);
  const remainderMonths = months - fullYears * 12;
  if (m === 0) {
    let flat = 0;
    for (let k = 0; k < fullYears; k++) flat += initialMonthly * Math.pow(1 + s, k) * 12;
    if (remainderMonths > 0) flat += initialMonthly * Math.pow(1 + s, fullYears) * remainderMonths;
    return flat;
  }
  const fv1yr = ((Math.pow(1 + m, 12) - 1) / m) * (1 + m);
  let fv = 0;
  for (let k = 0; k < fullYears; k++) {
    const yearP = initialMonthly * Math.pow(1 + s, k);
    const yearsToCompound = fullYears - 1 - k;
    const growth = Math.pow(1 + m, yearsToCompound * 12 + remainderMonths);
    fv += yearP * fv1yr * growth;
  }
  if (remainderMonths > 0) {
    const finalP = initialMonthly * Math.pow(1 + s, fullYears);
    fv += fvSip(finalP, annualReturnPct, remainderMonths);
  }
  return fv;
}

export function requiredStepUpSip(target: number, currentValue: number, annualReturnPct: number, months: number, stepUpPct: number): number {
  if (months <= 0) return 0;
  const lumpFV = fvLumpsum(currentValue, annualReturnPct, months);
  const need = Math.max(0, target - lumpFV);
  if (need === 0) return 0;
  const flatEst = requiredSip(target, currentValue, annualReturnPct, months);
  let lo = 0;
  let hi = Math.max(flatEst * 2, 100);
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const fv = fvStepUpSip(mid, annualReturnPct, months, stepUpPct);
    if (fv >= need) hi = mid;
    else lo = mid;
    if (hi - lo < 0.5) break;
  }
  return (lo + hi) / 2;
}

export function monthsBetween(from: Date, to: Date): number {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}

export type GoalStatus = "not_started" | "on_track" | "behind_track" | "achieved";

export interface GoalComputation {
  futureTarget: number;
  months: number;
  years: number;
  projectedTotalFV: number;
  requiredMonthlySipTotal: number;
  requiredStepUpInitialSip: number;
  requiredLumpsumToday: number;
  additionalMonthlySipNeeded: number;
  gapAmount: number;
  status: GoalStatus;
}

/** The single call used everywhere — mirrors calc.ts computeGoal exactly. */
export function computeGoal(input: {
  presentTarget?: number;
  futureTarget?: number;
  currentValue: number;
  existingMonthlySip: number;
  monthsLeft: number;
  expectedReturnPct?: number;
  inflationPct?: number;
  stepUpPct?: number;
}): GoalComputation {
  const ret = input.expectedReturnPct ?? DEFAULT_EXPECTED_RETURN_PCT;
  const infl = input.inflationPct ?? DEFAULT_INFLATION_PCT;
  const stepUpPct = input.stepUpPct ?? 0;
  const months = Math.max(0, Math.round(input.monthsLeft));
  const years = months / 12;
  const fT = input.futureTarget != null ? input.futureTarget : inflatedTarget(input.presentTarget ?? 0, infl, years);
  const pv = Math.max(0, input.currentValue);
  const sip = Math.max(0, input.existingMonthlySip);

  if (months === 0) {
    const gap = Math.max(0, fT - pv);
    return {
      futureTarget: fT, months, years, projectedTotalFV: pv,
      requiredMonthlySipTotal: 0, requiredStepUpInitialSip: 0, requiredLumpsumToday: fT,
      additionalMonthlySipNeeded: 0, gapAmount: gap,
      status: pv >= fT ? "achieved" : "behind_track",
    };
  }

  const projectedTotalFV = fvLumpsum(pv, ret, months) + fvSip(sip, ret, months);
  const reqTotal = requiredSip(fT, pv, ret, months);
  const reqStepUp = stepUpPct > 0 ? requiredStepUpSip(fT, pv, ret, months, stepUpPct) : reqTotal;
  const reqLump = requiredLumpsumToday(fT, ret, months);
  const additional = Math.max(0, reqTotal - sip);
  const gap = Math.max(0, fT - projectedTotalFV);

  let status: GoalStatus;
  if (pv === 0 && sip === 0) status = "not_started";
  else if (projectedTotalFV >= fT) status = "achieved";
  else if (sip >= reqTotal * 0.9) status = "on_track";
  else status = "behind_track";

  return {
    futureTarget: fT, months, years, projectedTotalFV,
    requiredMonthlySipTotal: reqTotal, requiredStepUpInitialSip: reqStepUp, requiredLumpsumToday: reqLump,
    additionalMonthlySipNeeded: additional, gapAmount: gap, status,
  };
}

export interface YearRow { year: number; monthlySip: number; contributedThisYear: number; cumulativeContributed: number; endOfYearCorpus: number }

/** Year-by-year projection (mirrors projectYearly). */
export function projectYearly(p: { currentValue: number; initialMonthlySip: number; annualReturnPct: number; stepUpPct?: number; months: number }): YearRow[] {
  const m = p.annualReturnPct / 100 / 12;
  const step = (p.stepUpPct ?? 0) / 100;
  const totalMonths = Math.max(0, Math.round(p.months));
  const years = Math.ceil(totalMonths / 12);
  let corpus = Math.max(0, p.currentValue);
  let monthlySip = Math.max(0, p.initialMonthlySip);
  let cumulative = 0;
  const rows: YearRow[] = [];
  let monthsDone = 0;
  for (let y = 1; y <= years; y++) {
    let contributedThisYear = 0;
    for (let mo = 0; mo < 12 && monthsDone < totalMonths; mo++) {
      corpus = corpus * (1 + m) + monthlySip;
      contributedThisYear += monthlySip;
      monthsDone++;
    }
    cumulative += contributedThisYear;
    rows.push({ year: y, monthlySip: Math.round(monthlySip), contributedThisYear: Math.round(contributedThisYear), cumulativeContributed: Math.round(cumulative), endOfYearCorpus: Math.round(corpus) });
    monthlySip = monthlySip * (1 + step);
  }
  return rows;
}

export interface SensitivityRow { ratePct: number; sip: number; lumpsum: number; projectedFV: number }

/** Required SIP / lumpsum / projected FV across a set of return assumptions. */
export function sensitivitySipRates(target: number, currentValue: number, months: number, rates: number[] = [8, 10, 12, 15]): SensitivityRow[] {
  return rates.map((ratePct) => ({
    ratePct,
    sip: requiredSip(target, currentValue, ratePct, months),
    lumpsum: requiredLumpsumToday(target, ratePct, months),
    projectedFV: fvLumpsum(currentValue, ratePct, months),
  }));
}
