/**
 * SIP 360° Planner — math engine.
 *
 * A comprehensive SIP analysis that, from a single monthly amount + horizon,
 * derives: normal vs step-up future value across two return scenarios, the
 * effect of investing for a limited number of years, the inflation-adjusted
 * (real) value of the corpus, and the higher SIP a client would need if they
 * delay starting.
 *
 * CONVENTION — effective monthly rate, begin-mode (annuity-due).
 *   Unlike the simpler goal-planning helpers (which use a nominal r/12 monthly
 *   rate), this engine converts the annual rate to an EFFECTIVE monthly rate:
 *       m = (1 + annual)^(1/12) − 1
 *   so "10% return" means exactly 10% per year (not 10.47% from monthly
 *   compounding of 10/12). SIPs are paid at the START of each month
 *   (annuity-due → the trailing × (1 + m)). These conventions reproduce the
 *   reference calculator's published figures to the rupee — do not switch to a
 *   nominal rate or month-end timing without re-checking the outputs.
 */

/** Effective monthly rate from an annual percentage. */
export function monthlyRate(annualPct: number): number {
  return Math.pow(1 + annualPct / 100, 1 / 12) - 1;
}

/** FV of a constant monthly SIP, paid at month-start (annuity-due). */
export function fvSip(monthly: number, annualPct: number, months: number): number {
  if (monthly <= 0 || months <= 0) return 0;
  const m = monthlyRate(annualPct);
  if (m === 0) return monthly * months; // flat-return limit
  return monthly * ((Math.pow(1 + m, months) - 1) / m) * (1 + m);
}

/** FV of a one-shot lumpsum compounding at the effective monthly rate. */
export function fvLumpsum(pv: number, annualPct: number, months: number): number {
  if (pv <= 0 || months <= 0) return pv > 0 ? pv : 0;
  return pv * Math.pow(1 + monthlyRate(annualPct), months);
}

/**
 * Total amount invested under a step-up SIP: the monthly amount is held
 * constant within a year and increased by `stepUpPct` at the start of each
 * subsequent year.
 */
export function stepUpInvested(monthly: number, stepUpPct: number, years: number): number {
  if (monthly <= 0 || years <= 0) return 0;
  const s = stepUpPct / 100;
  let total = 0;
  for (let y = 0; y < years; y++) total += monthly * Math.pow(1 + s, y) * 12;
  return total;
}

/**
 * FV of a step-up SIP — month-granular, annuity-due, effective monthly rate.
 * The monthly contribution for year y (0-indexed) is monthly × (1 + s)^y, paid
 * at the start of each month and grown to the end of the full horizon.
 */
export function fvStepUpSip(
  monthly: number,
  stepUpPct: number,
  annualPct: number,
  years: number
): number {
  if (monthly <= 0 || years <= 0) return 0;
  const m = monthlyRate(annualPct);
  const s = stepUpPct / 100;
  const totalMonths = years * 12;
  let fv = 0;
  for (let mo = 0; mo < totalMonths; mo++) {
    const y = Math.floor(mo / 12);
    const pay = monthly * Math.pow(1 + s, y);
    // Annuity-due: a payment at the start of month `mo` (time = mo) compounds
    // for (totalMonths − mo) months to reach the horizon.
    fv += pay * (m === 0 ? 1 : Math.pow(1 + m, totalMonths - mo));
  }
  return fv;
}

/**
 * Constant monthly SIP (begin-mode) needed to accumulate `target` over `months`.
 * Used by Cost-of-Delay: the same target FV, fewer months ⇒ a higher SIP.
 */
export function requiredSip(target: number, annualPct: number, months: number): number {
  if (months <= 0 || target <= 0) return 0;
  const m = monthlyRate(annualPct);
  if (m === 0) return target / months;
  const factor = ((Math.pow(1 + m, months) - 1) / m) * (1 + m);
  return target / factor;
}

/**
 * Limited-period SIP: invest monthly for `sipYears`, then stop and let the
 * accumulated corpus grow (no further contributions) until `totalYears`.
 */
export function limitedPeriodFv(
  monthly: number,
  sipYears: number,
  totalYears: number,
  annualPct: number
): number {
  if (sipYears <= 0) return 0;
  const corpusAtStop = fvSip(monthly, annualPct, sipYears * 12);
  const holdMonths = Math.max(0, (totalYears - sipYears) * 12);
  return holdMonths > 0 ? fvLumpsum(corpusAtStop, annualPct, holdMonths) : corpusAtStop;
}

/** Real (inflation-adjusted) value of a future nominal amount. */
export function realValue(nominal: number, inflationPct: number, years: number): number {
  if (nominal <= 0) return 0;
  return nominal / Math.pow(1 + inflationPct / 100, years);
}

/* ───────────────────────── Aggregate result ───────────────────────── */

export type Sip360Scenario = { key: "s1" | "s2"; ratePct: number };

export type Sip360Input = {
  monthly: number;
  years: number;
  scenarios: Sip360Scenario[]; // 1 or 2
  stepUp?: { enabled: boolean; pct: number };
  limited?: { enabled: boolean; durations: number[] }; // years, within `years`
  inflation?: { enabled: boolean; pct: number };
  delay?: { enabled: boolean; periods: number[] }; // years
};

export type Sip360Result = {
  months: number;
  normalInvested: number;
  stepUpInvested: number | null;
  /** Future value per scenario for normal + (optional) step-up SIP. */
  futureValue: Array<{ ratePct: number; normal: number; stepUp: number | null }>;
  /** Limited-period rows: investment + value per scenario. */
  limited: Array<{
    years: number;
    invested: number;
    values: Array<{ ratePct: number; value: number }>;
  }> | null;
  /** Inflation-adjusted (real) value of the NORMAL SIP corpus per scenario. */
  inflationAdjusted: Array<{ ratePct: number; nominal: number; real: number }> | null;
  /** Cost of delay: SIP required to still hit the normal target, per scenario. */
  costOfDelay: Array<{
    delayYears: number;
    required: Array<{ ratePct: number; sip: number }>;
  }> | null;
};

export function computeSip360(input: Sip360Input): Sip360Result {
  const months = Math.max(0, Math.round(input.years * 12));
  const scenarios = input.scenarios.filter((s) => Number.isFinite(s.ratePct));
  const stepEnabled = !!input.stepUp?.enabled && (input.stepUp?.pct ?? 0) > 0;
  const stepPct = input.stepUp?.pct ?? 0;

  const normalInvested = input.monthly * months;
  const stepInvested = stepEnabled
    ? stepUpInvested(input.monthly, stepPct, input.years)
    : null;

  const futureValue = scenarios.map((s) => ({
    ratePct: s.ratePct,
    normal: fvSip(input.monthly, s.ratePct, months),
    stepUp: stepEnabled ? fvStepUpSip(input.monthly, stepPct, s.ratePct, input.years) : null,
  }));

  // Limited period — only durations strictly inside the full horizon.
  let limited: Sip360Result["limited"] = null;
  if (input.limited?.enabled) {
    const durs = (input.limited.durations ?? [])
      .filter((d) => d > 0 && d < input.years)
      .sort((a, b) => a - b);
    if (durs.length) {
      limited = durs.map((d) => ({
        years: d,
        invested: input.monthly * d * 12,
        values: scenarios.map((s) => ({
          ratePct: s.ratePct,
          value: limitedPeriodFv(input.monthly, d, input.years, s.ratePct),
        })),
      }));
    }
  }

  // Inflation-adjusted real value of the NORMAL corpus.
  let inflationAdjusted: Sip360Result["inflationAdjusted"] = null;
  if (input.inflation?.enabled && (input.inflation.pct ?? 0) > 0) {
    inflationAdjusted = scenarios.map((s) => {
      const nominal = fvSip(input.monthly, s.ratePct, months);
      return {
        ratePct: s.ratePct,
        nominal,
        real: realValue(nominal, input.inflation!.pct, input.years),
      };
    });
  }

  // Cost of delay — required SIP to still hit the (no-delay) normal target,
  // investing over the reduced horizon.
  let costOfDelay: Sip360Result["costOfDelay"] = null;
  if (input.delay?.enabled) {
    const periods = (input.delay.periods ?? [])
      .filter((d) => d > 0 && d < input.years)
      .sort((a, b) => a - b);
    if (periods.length) {
      costOfDelay = periods.map((d) => ({
        delayYears: d,
        required: scenarios.map((s) => {
          const target = fvSip(input.monthly, s.ratePct, months);
          return { ratePct: s.ratePct, sip: requiredSip(target, s.ratePct, (input.years - d) * 12) };
        }),
      }));
    }
  }

  return {
    months,
    normalInvested,
    stepUpInvested: stepInvested,
    futureValue,
    limited,
    inflationAdjusted,
    costOfDelay,
  };
}
