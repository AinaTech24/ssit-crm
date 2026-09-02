/**
 * EMI → SIP Housing — wealth created by three ways of acquiring the SAME home,
 * all funded by the same EMI-equivalent cashflow (EFP "Patshala" workbook).
 * Verified to the rupee against the sheet (₹57.61 / 61.42 / 79.69 Cr).
 *
 *   1. Pay off early  — buy on loan; a growing SIP (= EMI, +growth%/yr) compounds
 *      until its corpus clears the loan, then SIP + the freed EMI build wealth.
 *   2. Keep loan       — buy on loan, run it the full tenure (cheap debt), and
 *      invest the EMI-equivalent SIP in equity the whole time.
 *   3. Rent & buy late — rent now, invest SIP + EMI every year, then buy the
 *      (escalated) house at the end and net off the rent paid.
 *
 * The model runs in annual steps; FV step = (prior + payment) × (1 + rate)
 * (annuity-due). Monthly income = an inflation-naïve SWP of the wealth for
 * `swpYears` at the SIP return.
 */

function emiAnnual(loan: number, ratePct: number, tenure: number): number {
  const r = ratePct / 100;
  if (tenure <= 0) return 0;
  return r === 0 ? loan / tenure : (loan * r) / (1 - Math.pow(1 + r, -tenure));
}

/** One annuity-due FV step. */
function fvStep(prior: number, payment: number, ratePct: number): number {
  return (prior + payment) * (1 + ratePct / 100);
}

/** Monthly income from a corpus drawn down over `years` (annuity-due), at `ratePct`. */
function monthlyIncomeFrom(wealth: number, ratePct: number, years: number): number {
  const r = ratePct / 100;
  if (wealth <= 0 || years <= 0) return 0;
  if (r === 0) return wealth / years / 12;
  const annual = (r * wealth * Math.pow(1 + r, years)) / ((Math.pow(1 + r, years) - 1) * (1 + r));
  return annual / 12;
}

export type HousingStrategy = {
  key: "payoff" | "keep" | "rentbuy";
  label: string;
  note: string;
  wealth: number;
  monthlyIncome: number;
  incrementalPct: number; // vs the first (pay-off-early) strategy
};

export type HousingResult = {
  emiAnnual: number;
  emiMonthly: number;
  loanOverYear: number; // year the early-payoff SIP clears the loan
  houseCostAtEnd: number;
  totalRentPaid: number;
  strategies: HousingStrategy[];
  bestKey: HousingStrategy["key"];
};

export function housingEmiSip(input: {
  loan: number;
  escalationPct: number;
  loanRatePct: number;
  tenureYears: number;
  sipReturnPct: number;
  sipGrowthPct: number;
  rentYieldPct: number;
  rentGrowthPct: number;
  swpYears?: number;
}): HousingResult {
  const tenure = Math.max(1, Math.round(input.tenureYears));
  const emi = emiAnnual(input.loan, input.loanRatePct, tenure);
  const swpYears = input.swpYears ?? 50;
  const g = input.sipGrowthPct / 100;

  // ── Strategy 1: pay off early, then wealth-build ──
  let s1 = (() => {
    let bal = input.loan, sipFV = 0, sip = emi, wb = 0, taxFV = 0, leftoverGrown = 0;
    let over = false, overYear = 0;
    for (let y = 1; y <= tenure; y++) {
      if (y > 1) sip *= 1 + g;
      if (!over) {
        const interest = (input.loanRatePct / 100) * bal;
        const principal = emi - interest;
        sipFV = fvStep(sipFV, sip, input.sipReturnPct);
        taxFV = fvStep(taxFV, Math.min(0.3 * interest, 60000), input.sipReturnPct);
        if (sipFV > bal) {
          over = true;
          overYear = y;
          leftoverGrown = (sipFV - bal) * Math.pow(1 + input.sipReturnPct / 100, tenure - y);
        } else {
          bal -= principal;
        }
      } else {
        wb = fvStep(wb, sip + emi, input.sipReturnPct);
        taxFV = fvStep(taxFV, 0, input.sipReturnPct);
      }
    }
    taxFV = fvStep(taxFV, 0, input.sipReturnPct); // sheet's trailing summary-row compounding
    return { wealth: wb + leftoverGrown + taxFV, overYear };
  })();

  // ── Strategy 2: keep loan full term, invest the EMI-equivalent ──
  const s2Wealth = (() => {
    let bal = input.loan, sipFV = 0, sip = emi, taxFV = 0;
    for (let y = 1; y <= tenure; y++) {
      const interest = (input.loanRatePct / 100) * bal;
      bal -= emi - interest;
      if (y > 1) sip *= 1 + g;
      sipFV = fvStep(sipFV, sip, input.sipReturnPct);
      taxFV = fvStep(taxFV, Math.min(0.3 * interest, 60000), input.sipReturnPct);
    }
    return sipFV + taxFV;
  })();

  // ── Strategy 3: rent + invest SIP+EMI, buy the escalated house at the end ──
  let houseCostAtEnd = input.loan;
  let totalRentPaid = 0;
  const s3Wealth = (() => {
    let fv = 0, sip = emi, house = input.loan, rent = input.loan * (input.rentYieldPct / 100);
    for (let y = 1; y <= tenure; y++) {
      if (y > 1) {
        sip *= 1 + g;
        house *= 1 + input.escalationPct / 100;
        rent *= 1 + input.rentGrowthPct / 100;
      }
      fv = fvStep(fv, sip + emi, input.sipReturnPct);
      totalRentPaid += rent;
    }
    houseCostAtEnd = house;
    return fv - totalRentPaid - house;
  })();

  const mk = (key: HousingStrategy["key"], label: string, note: string, wealth: number): HousingStrategy => ({
    key,
    label,
    note,
    wealth,
    monthlyIncome: monthlyIncomeFrom(wealth, input.sipReturnPct, swpYears),
    incrementalPct: s1.wealth > 0 ? (wealth - s1.wealth) / s1.wealth : 0,
  });

  const strategies = [
    mk("payoff", "Pay off loan early", `SIP clears the loan in ~${s1.overYear} yrs, then SIP + freed EMI compound`, s1.wealth),
    mk("keep", "Keep loan full term", "Run the cheap loan; invest the EMI-equivalent in equity", s2Wealth),
    mk("rentbuy", "Rent & buy at the end", "Rent, invest SIP + EMI, buy the house in cash later", s3Wealth),
  ];
  const bestKey = strategies.reduce((a, b) => (b.wealth > a.wealth ? b : a)).key;

  return {
    emiAnnual: emi,
    emiMonthly: emi / 12,
    loanOverYear: s1.overYear,
    houseCostAtEnd,
    totalRentPaid,
    strategies,
    bestKey,
  };
}
