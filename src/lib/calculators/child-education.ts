/**
 * Child Education Cost Projector — math engine.
 *
 * Education costs inflate far faster than CPI (≈10%/yr), so a generic goal
 * calculator understates them. This projects each education milestone (school /
 * UG / PG / abroad) at education inflation, then computes the monthly SIP and
 * lumpsum needed, offsetting any savings already earmarked.
 *
 * Convention: future cost compounds at education inflation; required SIP uses an
 * effective-monthly annuity-due factor.
 */

import { requiredMonthlySip } from "./goal-collision";

export type EduMilestone = {
  name: string;
  childAgeAtStart: number; // age when this course begins
  currentCost: number; // today's cost of the course
};

export type ChildEducationInput = {
  childCurrentAge: number;
  eduInflationPct: number;
  expectedReturnPct: number;
  existingSavings: number; // already earmarked for education
  milestones: EduMilestone[];
};

export type EduMilestoneResult = {
  name: string;
  yearsAway: number;
  futureCost: number;
  monthlySip: number;
  lumpsum: number;
};

export type ChildEducationResult = {
  milestones: EduMilestoneResult[];
  totalFutureCost: number;
  totalMonthlySip: number;
  totalLumpsum: number;
  existingSavingsFutureValue: number; // grown to the nearest milestone
  netAfterSavings: number;
};

export function computeChildEducation(input: ChildEducationInput): ChildEducationResult {
  const r = input.expectedReturnPct / 100;
  const g = input.eduInflationPct / 100;

  const sorted = [...input.milestones].sort((a, b) => a.childAgeAtStart - b.childAgeAtStart);
  const nearestYears = sorted.length ? Math.max(0, sorted[0].childAgeAtStart - input.childCurrentAge) : 0;
  const existingSavingsFutureValue = input.existingSavings * Math.pow(1 + r, nearestYears);

  // Earmarked savings are applied nearest-milestone first. Track the UNUSED
  // portion in TODAY's rupees and grow it to EACH milestone's own date, so a
  // later milestone's offset earns the extra years of compounding (the previous
  // code grew everything only to the nearest milestone, understating later offsets).
  let remainingSavingsToday = input.existingSavings;
  const milestones: EduMilestoneResult[] = sorted.map((mlt) => {
    const yearsAway = Math.max(0, mlt.childAgeAtStart - input.childCurrentAge);
    const grow = Math.pow(1 + r, yearsAway);
    const grossFuture = mlt.currentCost * Math.pow(1 + g, yearsAway);
    const availableAtMilestone = remainingSavingsToday * grow;
    const offset = Math.min(availableAtMilestone, grossFuture);
    remainingSavingsToday -= offset / grow; // consume in present-value terms
    const netFuture = Math.max(0, grossFuture - offset);
    return {
      name: mlt.name,
      yearsAway,
      futureCost: grossFuture,
      monthlySip: requiredMonthlySip(netFuture, input.expectedReturnPct, yearsAway),
      lumpsum: yearsAway > 0 ? netFuture / grow : netFuture,
    };
  });

  const totalFutureCost = milestones.reduce((s, m) => s + m.futureCost, 0);
  const totalMonthlySip = milestones.reduce((s, m) => s + m.monthlySip, 0);
  const totalLumpsum = milestones.reduce((s, m) => s + m.lumpsum, 0);

  return {
    milestones,
    totalFutureCost,
    totalMonthlySip,
    totalLumpsum,
    existingSavingsFutureValue,
    netAfterSavings: Math.max(0, totalFutureCost - existingSavingsFutureValue),
  };
}
