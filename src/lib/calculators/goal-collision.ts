/**
 * Goal-Collision Timeline — math engine.
 *
 * Plots every family goal on one timeline and sums the monthly SIP each goal
 * demands, year by year — surfacing the "crunch" years when several goals
 * overlap and the household's required monthly commitment peaks.
 *
 * Required monthly SIP per goal uses an effective-monthly annuity-due factor.
 */

import { monthlyRate } from "./sip360";

export type CollisionGoal = {
  name: string;
  yearsAway: number; // when the goal is due
  futureCost: number;
  returnPct: number;
};

/** Monthly SIP to reach `futureCost` in `years` at `ratePct` (begin mode). */
export function requiredMonthlySip(futureCost: number, ratePct: number, years: number): number {
  const months = Math.max(0, Math.round(years * 12));
  if (months <= 0) return futureCost;
  const m = monthlyRate(ratePct);
  const factor = m === 0 ? months : ((Math.pow(1 + m, months) - 1) / m) * (1 + m);
  return factor > 0 ? futureCost / factor : 0;
}

export type CollisionGoalResult = CollisionGoal & { monthlySip: number };

export type CollisionYear = {
  year: number;
  totalMonthly: number;
  activeGoals: string[];
};

export type GoalCollisionResult = {
  goals: CollisionGoalResult[];
  timeline: CollisionYear[];
  peakMonthly: number;
  peakYear: number;
  horizon: number;
};

export function computeGoalCollision(goals: CollisionGoal[]): GoalCollisionResult {
  const withSip: CollisionGoalResult[] = goals.map((g) => ({
    ...g,
    monthlySip: requiredMonthlySip(g.futureCost, g.returnPct, g.yearsAway),
  }));

  const horizon = Math.max(1, ...withSip.map((g) => Math.ceil(g.yearsAway)));
  const timeline: CollisionYear[] = [];
  let peakMonthly = 0;
  let peakYear = 1;

  for (let year = 1; year <= horizon; year++) {
    let totalMonthly = 0;
    const activeGoals: string[] = [];
    for (const g of withSip) {
      // A goal's SIP runs from now until the year it is due.
      if (year <= Math.ceil(g.yearsAway)) {
        totalMonthly += g.monthlySip;
        activeGoals.push(g.name);
      }
    }
    if (totalMonthly > peakMonthly) {
      peakMonthly = totalMonthly;
      peakYear = year;
    }
    timeline.push({ year, totalMonthly, activeGoals });
  }

  return { goals: withSip, timeline, peakMonthly, peakYear, horizon };
}
