/**
 * 4-Bucket Strategy for Youth Financial Freedom (EFP workbook).
 *
 * A young investor wants Financial Freedom (FF) at `freedomAge` and to be funded
 * to `longevity`. The post-FF income need is split across 4 funds of rising
 * risk/return — each funds a 10-year window of life (the 4th funds the
 * remainder). Because later windows sit in higher-return funds for longer, the
 * corpus needed at FF is far smaller than parking everything in one debt fund —
 * and so is the SIP to build it ("MFD Alpha").
 *
 * Faithful to the workbook, with two deliberate corrections:
 *   1. The sheet's Bucket-2 formula had a typo (`B5%` → inflation 0.0006 instead
 *      of 0.06); we use the real inflation for ALL buckets.
 *   2. Both SIPs accumulate over the SAME period (years-to-freedom); the sheet
 *      hard-coded 14 for the bucket SIP.
 * Bucket 1 corpus, the single-fund corpus and the normal SIP all reproduce the
 * sheet to the rupee.
 */

/** Excel PV(rate, nper, pmt, fv, type). */
function pv(rate: number, nper: number, pmt: number, fv = 0, type = 0): number {
  if (nper <= 0) return 0;
  if (rate === 0) return -(pmt * nper + fv);
  const p = Math.pow(1 + rate, -nper);
  return -(pmt * (1 + rate * type) * ((1 - p) / rate) + fv * p);
}

/** Excel PMT(rate, nper, pv, fv, type). */
function pmt(rate: number, nper: number, pvv: number, fv = 0, type = 0): number {
  if (nper <= 0) return 0;
  if (rate === 0) return -(pvv + fv) / nper;
  const p = Math.pow(1 + rate, nper);
  return -(rate * (pvv * p + fv)) / ((p - 1) * (1 + rate * type));
}

export type BucketRow = {
  name: string;
  returnPct: number;
  startYear: number; // years after FF this bucket starts funding
  years: number; // window length
  startAge: number;
  endAge: number;
  expenseAtStart: number; // monthly expense at the window start
  pvAtStart: number; // corpus needed at the window start
  pvAtFreedom: number; // discounted back to the freedom age
};

export type YouthBucketResult = {
  yearsToFreedom: number;
  totalFreedomYears: number;
  expenseAtFreedom: number; // monthly, at FF age
  buckets: BucketRow[];
  corpusBucket: number;
  corpusWithout: number;
  sipBucket: number; // monthly SIP — 4-bucket strategy
  sipWithout: number; // monthly SIP — single debt fund
  savingsAbs: number; // sipWithout − sipBucket
  savingsPct: number; // (sipWithout − sipBucket) / sipWithout
  corpusSavedPct: number; // (corpusWithout − corpusBucket) / corpusWithout
};

export function youthBucketStrategy(input: {
  monthlyExpenseToday: number;
  inflationPct: number;
  ageNow: number;
  freedomAge: number;
  longevity: number;
  debtReturnPct: number;
  hybridReturnPct: number;
  largeCapReturnPct: number;
  midCapReturnPct: number;
}): YouthBucketResult {
  const infl = input.inflationPct / 100;
  const ytf = Math.max(0, input.freedomAge - input.ageNow);
  const totalFF = Math.max(0, input.longevity - input.freedomAge);
  const expFF = input.monthlyExpenseToday * Math.pow(1 + infl, ytf);

  const rets = [input.debtReturnPct, input.hybridReturnPct, input.largeCapReturnPct, input.midCapReturnPct];
  const names = ["Bucket 1 · Debt", "Bucket 2 · Hybrid", "Bucket 3 · Large Cap", "Bucket 4 · Mid Cap"];
  const starts = [0, 10, 20, 30];
  const realRate = (retPct: number) => Math.pow((1 + retPct / 100) / (1 + infl), 1 / 12) - 1;

  const buckets: BucketRow[] = [];
  for (let k = 0; k < 4; k++) {
    const start = starts[k];
    const startAge = input.freedomAge + start;
    if (start >= totalFF) {
      buckets.push({
        name: names[k], returnPct: rets[k], startYear: start, years: 0,
        startAge, endAge: startAge, expenseAtStart: 0, pvAtStart: 0, pvAtFreedom: 0,
      });
      continue;
    }
    const years = k < 3 ? Math.min(10, totalFF - start) : totalFF - start;
    const expenseAtStart = input.monthlyExpenseToday * Math.pow(1 + infl, ytf + start);
    const pvAtStart = pv(realRate(rets[k]), years * 12, -expenseAtStart, 0, 1);
    const pvAtFreedom = pvAtStart / Math.pow(1 + rets[k] / 100, start);
    buckets.push({
      name: names[k], returnPct: rets[k], startYear: start, years,
      startAge, endAge: startAge + years, expenseAtStart, pvAtStart, pvAtFreedom,
    });
  }

  const corpusBucket = buckets.reduce((s, b) => s + b.pvAtFreedom, 0);
  const corpusWithout = pv(realRate(input.debtReturnPct), totalFF * 12, -expFF, 0, 1);

  // Accumulation SIP over years-to-freedom at the large-cap rate (annuity-due).
  // corpusBucket / corpusWithout are POSITIVE target future values, so the
  // target FV passed to PMT must be +corpus. (Passing -corpus flipped the sign
  // and produced a negative monthly SIP — and forced savingsPct to 0.)
  const accMonthly = Math.pow(1 + input.largeCapReturnPct / 100, 1 / 12) - 1;
  const sip = (corpus: number) => (ytf > 0 ? -pmt(accMonthly, ytf * 12, 0, corpus, 1) : 0);
  const sipBucket = sip(corpusBucket);
  const sipWithout = sip(corpusWithout);

  return {
    yearsToFreedom: ytf,
    totalFreedomYears: totalFF,
    expenseAtFreedom: expFF,
    buckets,
    corpusBucket,
    corpusWithout,
    sipBucket,
    sipWithout,
    savingsAbs: Math.max(0, sipWithout - sipBucket),
    savingsPct: sipWithout > 0 ? (sipWithout - sipBucket) / sipWithout : 0,
    corpusSavedPct: corpusWithout > 0 ? (corpusWithout - corpusBucket) / corpusWithout : 0,
  };
}
