/**
 * Per-tenant calculator assumptions loader. Returns India defaults when no row
 * exists yet (settings created lazily on first save).
 */

import { eq } from "drizzle-orm";
import { calculatorSettings } from "@/db/schema";

export type CalcAssumptions = {
  returnPct: number;
  inflationPct: number;
  educationInflationPct: number;
  debtReturnPct: number;
};

export const DEFAULT_CALC_ASSUMPTIONS: CalcAssumptions = {
  returnPct: 12,
  inflationPct: 6,
  educationInflationPct: 10,
  debtReturnPct: 7,
};

type Tx = { select: any };

function num(v: any, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export async function loadCalcAssumptions(tx: Tx, tenantId: string): Promise<CalcAssumptions> {
  const row = (
    await tx.select().from(calculatorSettings).where(eq(calculatorSettings.tenantId, tenantId)).limit(1)
  )[0];
  if (!row) return { ...DEFAULT_CALC_ASSUMPTIONS };
  return {
    returnPct: num(row.defaultReturnPct, DEFAULT_CALC_ASSUMPTIONS.returnPct),
    inflationPct: num(row.defaultInflationPct, DEFAULT_CALC_ASSUMPTIONS.inflationPct),
    educationInflationPct: num(row.educationInflationPct, DEFAULT_CALC_ASSUMPTIONS.educationInflationPct),
    debtReturnPct: num(row.debtReturnPct, DEFAULT_CALC_ASSUMPTIONS.debtReturnPct),
  };
}
