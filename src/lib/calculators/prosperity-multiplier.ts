/**
 * Prosperity Multiplier (SIP → SWP) — accumulate, then draw a growing income.
 *
 * Phase 1 (accumulation): a monthly SIP (with optional annual step-up) + optional
 * lumpsum, year by year. Closing = opening×(1+rate) + the year's SIP grown to
 * year-end (monthly compounding) — faithful to the worksheet:
 *   interest = -FV(rate/12,12,sip/12,0,0) - sip + opening×rate
 * Phase 2 (distribution): from the accumulated corpus, draw an annual income
 * (monthly×12) that rises with inflation each year, while the corpus earns its
 * return. Closing = opening×(1+rate) − annualWithdrawal. Shows whether the
 * income can grow for decades AND the corpus still grows (the "multiplier").
 */

export type ProsperityInput = {
  monthlySip: number;
  investYears: number;
  accumRatePct: number;
  sipStepUpPct: number;
  lumpsum: number;
  monthlyWithdrawal: number;
  withdrawalYears: number;
  withdrawRatePct: number;
  inflationPct: number;
};

export type AccumRow = { year: number; openingBal: number; investment: number; interest: number; closingBal: number };
export type DrawRow = { year: number; corpus: number; withdrawal: number; interest: number; closingBal: number };

export type ProsperityResult = {
  accum: AccumRow[];
  draw: DrawRow[];
  totalInvested: number;
  totalInterestAccum: number;
  totalCorpus: number; // corpus at end of accumulation
  totalWithdrawn: number;
  endingCorpus: number; // corpus after the withdrawal period
  depletedYear: number | null; // calendar year index within draw phase, if it runs out
  series: { year: number; value: number; phase: "accumulate" | "withdraw" }[];
};

/** FV of a year's monthly contributions to year-end (ordinary annuity, monthly comp). */
function fvMonthly(annualContribution: number, annualRatePct: number): number {
  const i = annualRatePct / 100 / 12;
  const pmt = annualContribution / 12;
  if (i === 0) return pmt * 12;
  return pmt * ((Math.pow(1 + i, 12) - 1) / i);
}

export function computeProsperityMultiplier(p: ProsperityInput): ProsperityResult {
  const investYears = Math.max(0, Math.round(p.investYears));
  const withdrawalYears = Math.max(0, Math.round(p.withdrawalYears));
  const accR = Math.max(0, p.accumRatePct) / 100;
  const drawR = Math.max(0, p.withdrawRatePct) / 100;
  const stepUp = Math.max(0, p.sipStepUpPct) / 100;
  const infl = Math.max(0, p.inflationPct) / 100;

  // ── Phase 1: accumulation ──
  const accum: AccumRow[] = [];
  let opening = Math.max(0, p.lumpsum);
  let yearSip = Math.max(0, p.monthlySip) * 12;
  let totalInvested = Math.max(0, p.lumpsum);
  let totalInterestAccum = 0;
  for (let y = 1; y <= investYears; y++) {
    const investment = yearSip;
    const interest = opening * accR + (fvMonthly(yearSip, p.accumRatePct) - yearSip);
    const closing = opening + investment + interest;
    accum.push({ year: y, openingBal: opening, investment, interest, closingBal: closing });
    totalInvested += investment;
    totalInterestAccum += interest;
    opening = closing;
    yearSip = yearSip * (1 + stepUp);
  }
  const totalCorpus = accum.length ? accum[accum.length - 1].closingBal : Math.max(0, p.lumpsum);

  // ── Phase 2: distribution ──
  const draw: DrawRow[] = [];
  let corpus = totalCorpus;
  let annualWithdrawal = Math.max(0, p.monthlyWithdrawal) * 12;
  let totalWithdrawn = 0;
  let depletedYear: number | null = null;
  for (let y = 1; y <= withdrawalYears; y++) {
    const interest = corpus * drawR;
    const closing = corpus - annualWithdrawal + interest;
    draw.push({ year: y, corpus, withdrawal: annualWithdrawal, interest, closingBal: closing });
    totalWithdrawn += Math.min(annualWithdrawal, corpus + interest); // don't count more than available
    if (closing <= 0 && depletedYear === null) depletedYear = y;
    corpus = Math.max(0, closing);
    annualWithdrawal = annualWithdrawal * (1 + infl);
  }
  const endingCorpus = draw.length ? Math.max(0, draw[draw.length - 1].closingBal) : totalCorpus;

  // ── Combined timeline for charting ──
  const series: ProsperityResult["series"] = [];
  accum.forEach((r) => series.push({ year: r.year, value: r.closingBal, phase: "accumulate" }));
  draw.forEach((r) => series.push({ year: investYears + r.year, value: Math.max(0, r.closingBal), phase: "withdraw" }));

  return {
    accum,
    draw,
    totalInvested,
    totalInterestAccum,
    totalCorpus,
    totalWithdrawn,
    endingCorpus,
    depletedYear,
    series,
  };
}
