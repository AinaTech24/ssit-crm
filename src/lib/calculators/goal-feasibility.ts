/**
 * Goal-Feasibility Score — math engine.
 *
 * Scores how on-track a household is (0–100) by comparing the monthly SIP its
 * goals require against what it can actually invest, after crediting the future
 * value of its existing corpus toward the goals. Also factors the savings rate.
 */

import { requiredMonthlySip } from "./goal-collision";

export type FeasGoal = { name: string; futureCost: number; yearsAway: number; returnPct: number };

export type FeasInput = {
  monthlyIncome: number;
  currentMonthlySip: number; // what they invest now
  existingCorpus: number;
  corpusReturnPct: number; // growth assumption for the existing corpus
  goals: FeasGoal[];
};

export type FeasGoalResult = FeasGoal & { requiredMonthly: number };

export type FeasResult = {
  goals: FeasGoalResult[];
  requiredMonthlyTotal: number;
  corpusCoversMonthlyEquivalent: number; // existing corpus expressed as monthly SIP it offsets
  netRequiredMonthly: number;
  availableMonthly: number;
  coverageRatio: number; // available / netRequired
  savingsRatePct: number;
  score: number; // 0-100
  gapMonthly: number;
};

export function computeGoalFeasibility(input: FeasInput): FeasResult {
  const goals: FeasGoalResult[] = input.goals.map((g) => ({
    ...g,
    requiredMonthly: requiredMonthlySip(g.futureCost, g.returnPct, g.yearsAway),
  }));
  const requiredMonthlyTotal = goals.reduce((s, g) => s + g.requiredMonthly, 0);

  // Credit the existing corpus: grow it to the longest goal horizon, then express
  // the shortfall it covers as an equivalent monthly SIP reduction.
  const longest = Math.max(1, ...goals.map((g) => g.yearsAway));
  const corpusFV = input.existingCorpus * Math.pow(1 + input.corpusReturnPct / 100, longest);
  const corpusCoversMonthlyEquivalent = requiredMonthlySip(corpusFV, input.corpusReturnPct, longest);

  const netRequiredMonthly = Math.max(0, requiredMonthlyTotal - corpusCoversMonthlyEquivalent);
  const availableMonthly = input.currentMonthlySip;
  const coverageRatio = netRequiredMonthly > 0 ? availableMonthly / netRequiredMonthly : 1;

  const savingsRatePct = input.monthlyIncome > 0 ? (input.currentMonthlySip / input.monthlyIncome) * 100 : 0;

  // Score: 85% from coverage, 15% from a healthy (≥20%) savings rate.
  const coverageScore = Math.min(1, coverageRatio) * 85;
  const savingsScore = Math.min(1, savingsRatePct / 20) * 15;
  const score = Math.round(coverageScore + savingsScore);

  return {
    goals,
    requiredMonthlyTotal,
    corpusCoversMonthlyEquivalent,
    netRequiredMonthly,
    availableMonthly,
    coverageRatio,
    savingsRatePct,
    score: Math.max(0, Math.min(100, score)),
    gapMonthly: Math.max(0, netRequiredMonthly - availableMonthly),
  };
}
