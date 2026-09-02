/**
 * Early-Start Child SIP — the "start at birth" wealth story.
 *
 * Invest a monthly SIP into a child's name from `startAge` until `investTillAge`
 * (annuity-due, monthly compounding) to build a corpus. Then STOP contributing
 * and let that corpus compound annually to milestone ages. Demonstrates how a
 * limited early-years SIP becomes a life-changing sum decades later.
 *
 * Faithful to the worksheet: corpus at the till-age = FV(rate/12, months, -SIP,
 * type=1); each later milestone = previous × (1+rate)^years. Improvements:
 * configurable return + project-to age, a yearly growth series, and the
 * multiple-on-invested.
 */

export type ChildSipInput = {
  startAge: number;
  monthlySip: number;
  investTillAge: number;
  returnPct: number;
  projectToAge: number;
};

export type ChildSipMilestone = { age: number; value: number; multiple: number };

export type ChildSipResult = {
  investYears: number;
  totalInvested: number;
  corpusAtTill: number;
  milestones: ChildSipMilestone[];
  series: { age: number; value: number }[];
  finalAge: number;
  finalValue: number;
  finalMultiple: number;
};

/** Monthly SIP future value, annuity-due (contribution at start of month). */
function sipFvAnnuityDue(monthly: number, annualRatePct: number, months: number): number {
  const i = annualRatePct / 100 / 12;
  if (months <= 0) return 0;
  if (i === 0) return monthly * months;
  return monthly * ((Math.pow(1 + i, months) - 1) / i) * (1 + i);
}

const lumpFv = (amount: number, ratePct: number, years: number) => amount * Math.pow(1 + ratePct / 100, years);

export function computeChildSip(p: ChildSipInput): ChildSipResult {
  const startAge = Math.max(0, Math.round(p.startAge));
  const investTillAge = Math.max(startAge, Math.round(p.investTillAge));
  const projectToAge = Math.max(investTillAge, Math.round(p.projectToAge));
  const r = Math.max(0, p.returnPct);
  const sip = Math.max(0, p.monthlySip);

  const investYears = investTillAge - startAge;
  const totalInvested = sip * investYears * 12;
  const corpusAtTill = sipFvAnnuityDue(sip, r, investYears * 12);

  // Value at any age >= investTillAge: corpus compounded annually.
  const valueAtAge = (age: number) =>
    age <= startAge
      ? 0
      : age <= investTillAge
        ? sipFvAnnuityDue(sip, r, (age - startAge) * 12)
        : lumpFv(corpusAtTill, r, age - investTillAge);

  // Milestones: corpus at the till-age, then every 5 years up to projectToAge.
  const milestoneAges: number[] = [investTillAge];
  for (let a = Math.ceil((investTillAge + 1) / 5) * 5; a <= projectToAge; a += 5) milestoneAges.push(a);
  if (milestoneAges[milestoneAges.length - 1] !== projectToAge) milestoneAges.push(projectToAge);
  const milestones: ChildSipMilestone[] = Array.from(new Set(milestoneAges))
    .filter((a) => a >= investTillAge)
    .sort((a, b) => a - b)
    .map((age) => {
      const value = valueAtAge(age);
      return { age, value, multiple: totalInvested > 0 ? value / totalInvested : 0 };
    });

  const series = Array.from({ length: projectToAge - startAge + 1 }, (_, k) => {
    const age = startAge + k;
    return { age, value: valueAtAge(age) };
  });

  const finalValue = valueAtAge(projectToAge);
  return {
    investYears,
    totalInvested,
    corpusAtTill,
    milestones,
    series,
    finalAge: projectToAge,
    finalValue,
    finalMultiple: totalInvested > 0 ? finalValue / totalInvested : 0,
  };
}
