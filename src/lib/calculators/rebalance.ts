/**
 * Portfolio Rebalancing — math engine.
 *
 * From current holdings (value per asset class) and a target allocation,
 * computes the buy/sell needed per class to get back to target. Optional new
 * money is deployed first to the most-underweight classes, minimising taxable
 * selling.
 */

export type Holding = { assetClass: string; currentValue: number; targetPct: number };

export type RebalanceRow = {
  assetClass: string;
  currentValue: number;
  currentPct: number;
  targetPct: number;
  targetValue: number;
  action: number; // +buy / −sell
  fromNewMoney: number;
};

export type RebalanceResult = {
  totalCurrent: number;
  totalAfter: number;
  rows: RebalanceRow[];
  totalBuy: number;
  totalSell: number;
  newMoneyUsed: number;
};

export function computeRebalance(holdings: Holding[], newMoney: number): RebalanceResult {
  const totalCurrent = holdings.reduce((s, h) => s + h.currentValue, 0);
  const totalAfter = totalCurrent + Math.max(0, newMoney);
  const targetTotal = holdings.reduce((s, h) => s + h.targetPct, 0) || 100;

  // Target value uses the post-new-money total.
  const base = holdings.map((h) => {
    const targetValue = (totalAfter * h.targetPct) / targetTotal;
    return { h, targetValue, gap: targetValue - h.currentValue };
  });

  // Deploy new money to underweight classes first (largest positive gap).
  let remainingNew = Math.max(0, newMoney);
  const underweight = [...base].filter((b) => b.gap > 0).sort((a, b) => b.gap - a.gap);
  const newMoneyMap = new Map<string, number>();
  for (const b of underweight) {
    if (remainingNew <= 0) break;
    const take = Math.min(remainingNew, b.gap);
    newMoneyMap.set(b.h.assetClass, take);
    remainingNew -= take;
  }

  const rows: RebalanceRow[] = base.map((b) => {
    const fromNew = newMoneyMap.get(b.h.assetClass) ?? 0;
    const action = b.gap; // net change needed (buy positive / sell negative)
    return {
      assetClass: b.h.assetClass,
      currentValue: b.h.currentValue,
      currentPct: totalCurrent > 0 ? (b.h.currentValue / totalCurrent) * 100 : 0,
      targetPct: b.h.targetPct,
      targetValue: b.targetValue,
      action,
      fromNewMoney: fromNew,
    };
  });

  const totalBuy = rows.filter((r) => r.action > 0).reduce((s, r) => s + r.action, 0);
  const totalSell = rows.filter((r) => r.action < 0).reduce((s, r) => s + -r.action, 0);

  return { totalCurrent, totalAfter, rows, totalBuy, totalSell, newMoneyUsed: Math.max(0, newMoney) - remainingNew };
}
