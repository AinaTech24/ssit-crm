/**
 * Calculator math regression check (no test runner is configured, so this is a
 * runnable tsx assertion script — same pattern as the other scripts/*.ts).
 *
 *   npx tsx scripts/check-calc-math.ts      # exits 0 on pass, 1 on any failure
 *
 * Focus: the flat-return (0%) limits that previously produced NaN, plus a few
 * known-good values and an inverse round-trip, so a future edit to the formulas
 * can't silently regress the client-facing numbers.
 */

import {
  fvSip,
  fvLumpsum,
  requiredSip,
  fvStepUpSip,
  requiredStepUpSip,
  cagrCalculate,
  computeGoal,
  retirementCorpus,
} from "../src/lib/goal-planning/calc";
import { youthBucketStrategy } from "../src/lib/calculators/bucket-strategy";
import { familyWealthPlan } from "../src/lib/calculators/family-wealth";
import { journeyToFreedom } from "../src/lib/calculators/journey-to-freedom";
import { housingEmiSip } from "../src/lib/calculators/housing-emi-sip";

let failures = 0;

function ok(name: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function approx(a: number, b: number, tolPct = 0.5): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  if (b === 0) return Math.abs(a) < 1e-6;
  return Math.abs((a - b) / b) * 100 <= tolPct;
}

console.log("[calc] flat-return (0%) limits — must be finite, not NaN:");
ok("fvSip(10000, 0%, 120) = 12,00,000", fvSip(10000, 0, 120) === 1_200_000, String(fvSip(10000, 0, 120)));
ok("requiredSip(12,00,000, 0, 0%, 120) = 10,000", requiredSip(1_200_000, 0, 0, 120) === 10_000, String(requiredSip(1_200_000, 0, 0, 120)));
{
  // Step-up at 0% = sum of stepped contributions (no growth).
  let flat = 0;
  for (let k = 0; k < 10; k++) flat += 10000 * Math.pow(1.1, k) * 12;
  ok("fvStepUpSip(10000, 0%, 120, 10%) = Σ contributions", approx(fvStepUpSip(10000, 0, 120, 10), flat, 0.001), `${fvStepUpSip(10000, 0, 120, 10)} vs ${flat}`);
}
ok("requiredStepUpSip(…, 0%, …) is finite", Number.isFinite(requiredStepUpSip(1_000_000, 0, 0, 120, 10)));
ok("computeGoal(0% return) status not NaN", Number.isFinite(computeGoal({ futureTarget: 5_000_000, currentValue: 0, existingMonthlySip: 0, monthsLeft: 120, expectedReturnPct: 0 }).requiredMonthlySipTotal));
ok("retirementCorpus(0% pre/post) finite", Number.isFinite(retirementCorpus({ currentAge: 30, retirementAge: 60, lifeExpectancy: 85, monthlyIncomeTodayInr: 50000, inflationPct: 6, preReturnPct: 0, postReturnPct: 0, existingFundInr: 0 }).monthlySavingsRequired));

console.log("[calc] known-good values @ 12%:");
ok("fvSip(10000, 12%, 120) ≈ 23,23,391", approx(fvSip(10000, 12, 120), 2_323_391, 0.1), String(Math.round(fvSip(10000, 12, 120))));
ok("fvLumpsum(100000, 12%, 120) ≈ 3,30,039", approx(fvLumpsum(100000, 12, 120), 330_039, 0.1), String(Math.round(fvLumpsum(100000, 12, 120))));
ok("step-up beats flat @12%", fvStepUpSip(10000, 12, 120, 10) > fvSip(10000, 12, 120));

console.log("[calc] inverse round-trip (requiredSip → fvSip):");
{
  const T = 5_000_000;
  const req = requiredSip(T, 0, 12, 120);
  ok("fvSip(requiredSip(T)) ≈ T", approx(fvSip(req, 12, 120), T, 0.1), `${Math.round(fvSip(req, 12, 120))} vs ${T}`);
}

console.log("[calc] CAGR:");
ok("cagr(100→200 over 10y) ≈ 7.177%", approx(cagrCalculate({ initialValue: 100, finalValue: 200, years: 10 }).cagrPct, 7.177, 0.5));
ok("cagr guards initial=0", cagrCalculate({ initialValue: 0, finalValue: 200, years: 10 }).cagrPct === 0);

// ── New EFP calculator libs — invariants + pinned reference values so a future
// edit can't silently regress the client-facing numbers (these had no coverage,
// and the bucket SIP sign bug shipped uncaught). Inputs match the components'
// defaults / representative scenarios; expected values captured from the libs.
console.log("[calc] 4-bucket strategy (youthBucketStrategy):");
{
  const b = youthBucketStrategy({
    monthlyExpenseToday: 80000, inflationPct: 6, ageNow: 25, freedomAge: 41,
    longevity: 90, debtReturnPct: 8, hybridReturnPct: 10, largeCapReturnPct: 12, midCapReturnPct: 15,
  });
  ok("SIPs are POSITIVE (sign-bug guard)", b.sipBucket > 0 && b.sipWithout > 0, `bucket=${Math.round(b.sipBucket)} without=${Math.round(b.sipWithout)}`);
  ok("bucket SIP < single-fund SIP (the 'MFD alpha')", b.sipBucket < b.sipWithout);
  ok("savingsPct ≈ 43% (not the guarded 0)", approx(b.savingsPct, 0.4299, 0.5));
  ok("corpusBucket ≈ 4.47 Cr", approx(b.corpusBucket, 44_654_598, 0.1), String(Math.round(b.corpusBucket)));
  ok("sipBucket ≈ 81,813/mo", approx(b.sipBucket, 81_813, 0.2), String(Math.round(b.sipBucket)));
}

console.log("[calc] family wealth plan (familyWealthPlan):");
{
  const f = familyWealthPlan({
    lumpsum: 1_000_000, monthlySip: 50_000, currentAge: 30, targetAge: 60,
    classes: [{ name: "Equity", allocationPct: 60, returnPct: 12 }, { name: "Debt", allocationPct: 40, returnPct: 7 }],
  });
  ok("totalInvested = 1.9 Cr (10L + 50k×360)", f.totalInvested === 19_000_000, String(f.totalInvested));
  ok("blended return = 10% (60/40 of 12/7)", approx(f.blendedReturnPct, 10, 0.01));
  ok("finalTotal > totalInvested and finite", Number.isFinite(f.finalTotal) && f.finalTotal > f.totalInvested);
  ok("finalTotal ≈ 14.26 Cr", approx(f.finalTotal, 142_583_724, 0.1), String(Math.round(f.finalTotal)));
}

console.log("[calc] journey to freedom (journeyToFreedom):");
{
  const j = journeyToFreedom({ salaryMonthly: 100_000, expensesMonthly: 50_000, inflationPct: 6, returnPct: 12 });
  ok("monthly investable = salary − expenses", j.investmentMonthly === 50_000);
  ok("annual expense = 6,00,000", j.annualExpense === 600_000);
  ok("real rate ≈ 5.66%", approx(j.realRatePct, 5.6604, 0.5));
  ok("freedom corpus ≈ 1.12 Cr", approx(j.freedomCorpus, 11_200_000, 0.1), String(Math.round(j.freedomCorpus)));
  ok("reaches freedom within horizon", j.freedomYear !== null && j.freedomYear > 0);
}

console.log("[calc] EMI→SIP housing (housingEmiSip):");
{
  const h = housingEmiSip({
    loan: 5_000_000, escalationPct: 7, loanRatePct: 9, tenureYears: 20,
    sipReturnPct: 12, sipGrowthPct: 10, rentYieldPct: 3, rentGrowthPct: 7,
  });
  ok("all three strategies finite & positive", h.strategies.every((s) => Number.isFinite(s.wealth) && s.wealth > 0));
  ok("monthly EMI ≈ 45,644", approx(h.emiMonthly, 45_644, 0.5), String(Math.round(h.emiMonthly)));
  ok("payoff wealth ≈ 9.01 Cr", approx(h.strategies[0].wealth, 90_093_480, 0.2), String(Math.round(h.strategies[0].wealth)));
  ok("bestKey is a real strategy key", ["payoff", "keep", "rentbuy"].includes(h.bestKey));
}

if (failures === 0) {
  console.log("\n[calc] all checks passed ✓");
  process.exit(0);
} else {
  console.error(`\n[calc] ${failures} check(s) FAILED ✗`);
  process.exit(1);
}
