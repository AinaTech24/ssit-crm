/**
 * Real Return (Inflation + Tax) — math engine.
 *
 * Turns a headline nominal return into what actually reaches the investor:
 * post-tax, then inflation-adjusted ("real") return. The eye-opener that shows
 * a 7% FD can be negative in real, post-tax terms.
 *
 *   post-tax nominal = nominal × (1 − tax)
 *   real             = (1 + postTaxNominal) / (1 + inflation) − 1
 */

export function postTaxNominal(nominalPct: number, taxPct: number): number {
  return nominalPct * (1 - taxPct / 100);
}

export function realReturn(postTaxNominalPct: number, inflationPct: number): number {
  return ((1 + postTaxNominalPct / 100) / (1 + inflationPct / 100) - 1) * 100;
}

export type Instrument = {
  name: string;
  nominalPct: number;
  taxPct: number; // effective tax on the return
};

export type RealReturnRow = {
  name: string;
  nominalPct: number;
  taxPct: number;
  postTaxNominalPct: number;
  realPct: number;
  realFutureValue: number; // purchasing power of `amount` after `years`
};

export function computeRealReturns(
  instruments: Instrument[],
  inflationPct: number,
  amount: number,
  years: number
): RealReturnRow[] {
  return instruments.map((it) => {
    const ptn = postTaxNominal(it.nominalPct, it.taxPct);
    const real = realReturn(ptn, inflationPct);
    return {
      name: it.name,
      nominalPct: it.nominalPct,
      taxPct: it.taxPct,
      postTaxNominalPct: ptn,
      realPct: real,
      realFutureValue: amount * Math.pow(1 + real / 100, Math.max(0, years)),
    };
  });
}
