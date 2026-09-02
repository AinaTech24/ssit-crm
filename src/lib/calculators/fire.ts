/**
 * FIRE / Financial-Independence Number — math engine.
 *
 * Finds the corpus needed to be financially independent (the "FIRE number")
 * using a safe-withdrawal rate, and the earliest age the client reaches it
 * given current savings + an ongoing (optionally stepped-up) SIP. Also checks
 * that the corpus actually sustains inflation-rising expenses to life
 * expectancy.
 *
 * Convention: effective monthly rate for accumulation; annual model for the
 * sustainability check.
 */

import { monthlyRate } from "./sip360";

export type FireInput = {
  currentAge: number;
  monthlyExpenseNow: number;
  inflationPct: number;
  preReturnPct: number; // accumulation
  postReturnPct: number; // withdrawal phase
  currentCorpus: number;
  monthlySip: number;
  sipStepUpPct: number;
  swrPct: number; // safe withdrawal rate, e.g. 4
  lifeExpectancy: number;
};

export type FireResult = {
  fireNumberToday: number; // annual expense now / SWR
  fireAge: number | null; // earliest age corpus ≥ inflation-adjusted FIRE number
  fireCorpus: number | null; // required corpus at the FIRE age
  corpusAtFire: number | null; // projected corpus at the FIRE age
  yearsToFire: number | null;
  sustainsToLifeExpectancy: boolean;
  shortfallAge: number | null; // age the corpus would run out, if it does
};

function projectedCorpus(input: FireInput, years: number): number {
  const m = monthlyRate(input.preReturnPct);
  let corpus = input.currentCorpus * Math.pow(1 + m, years * 12);
  let monthly = input.monthlySip;
  for (let y = 0; y < years; y++) {
    if (y > 0) monthly *= 1 + input.sipStepUpPct / 100;
    for (let mo = 0; mo < 12; mo++) {
      const remaining = (years - y) * 12 - mo;
      corpus += monthly * Math.pow(1 + m, remaining);
    }
  }
  return corpus;
}

/** Does `corpus` sustain inflation-rising annual expenses to life expectancy? */
function sustainabilityCheck(
  corpus: number,
  annualExpenseAtStart: number,
  postReturnPct: number,
  inflationPct: number,
  startAge: number,
  lifeExpectancy: number
): { ok: boolean; shortfallAge: number | null } {
  const r = postReturnPct / 100;
  const g = inflationPct / 100;
  let bal = corpus;
  let expense = annualExpenseAtStart;
  for (let age = startAge; age < lifeExpectancy; age++) {
    bal -= expense; // withdraw at year start
    if (bal < 0) return { ok: false, shortfallAge: age };
    bal *= 1 + r;
    expense *= 1 + g;
  }
  return { ok: true, shortfallAge: null };
}

export function computeFire(input: FireInput): FireResult {
  const annualExpenseNow = input.monthlyExpenseNow * 12;
  const swr = input.swrPct / 100;
  const fireNumberToday = swr > 0 ? annualExpenseNow / swr : 0;

  let fireAge: number | null = null;
  let fireCorpus: number | null = null;
  let corpusAtFire: number | null = null;
  let yearsToFire: number | null = null;

  const maxYears = Math.max(0, input.lifeExpectancy - input.currentAge);
  for (let y = 0; y <= maxYears; y++) {
    const age = input.currentAge + y;
    const expenseAtAge = annualExpenseNow * Math.pow(1 + input.inflationPct / 100, y);
    const requiredFire = swr > 0 ? expenseAtAge / swr : Infinity;
    const corpus = projectedCorpus(input, y);
    if (corpus >= requiredFire) {
      fireAge = age;
      fireCorpus = requiredFire;
      corpusAtFire = corpus;
      yearsToFire = y;
      break;
    }
  }

  let sustainsToLifeExpectancy = false;
  let shortfallAge: number | null = null;
  if (fireAge !== null && corpusAtFire !== null) {
    const annualExpenseAtFire = annualExpenseNow * Math.pow(1 + input.inflationPct / 100, yearsToFire ?? 0);
    const chk = sustainabilityCheck(corpusAtFire, annualExpenseAtFire, input.postReturnPct, input.inflationPct, fireAge, input.lifeExpectancy);
    sustainsToLifeExpectancy = chk.ok;
    shortfallAge = chk.shortfallAge;
  }

  return {
    fireNumberToday,
    fireAge,
    fireCorpus,
    corpusAtFire,
    yearsToFire,
    sustainsToLifeExpectancy,
    shortfallAge,
  };
}
