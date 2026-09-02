/**
 * Apply a directly-chosen risk-profile CATEGORY to a client (no questionnaire) —
 * used by the Add-Investor form and the CSV importer. It inserts a
 * `risk_profile_responses` history row and refreshes the cached risk columns on
 * the investor, so a category picked at create/import time behaves like a real
 * (if minimal) risk profile. No-op when the category is unchanged.
 */

import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { riskProfileResponses, investors } from "@/db/schema";

export const RISK_CATEGORIES = ["conservative", "moderate", "aggressive", "very_aggressive"] as const;
export type RiskCategory = (typeof RISK_CATEGORIES)[number];

// Representative mid-band score for a category chosen directly (the real score
// comes from the 8-question SEBI questionnaire; here we only have the category).
const SCORE_BY_CATEGORY: Record<RiskCategory, number> = {
  conservative: 13,
  moderate: 24,
  aggressive: 35,
  very_aggressive: 40,
};

/** Coerce free text (form value or spreadsheet cell) to a canonical category. */
export function normalizeRiskCategory(raw: any): RiskCategory | null {
  const s = String(raw ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  return (RISK_CATEGORIES as readonly string[]).includes(s) ? (s as RiskCategory) : null;
}

export async function applyRiskCategory(opts: {
  tx: Tx;
  tenantId: string;
  investorId: string;
  category: RiskCategory;
  /** The client's current category — pass to skip a no-op re-write on import updates. */
  currentCategory?: string | null;
  createdById?: string | null;
  signedByName?: string | null;
}): Promise<void> {
  const { tx, tenantId, investorId, category, currentCategory, createdById, signedByName } = opts;
  if (currentCategory && currentCategory === category) return; // unchanged — nothing to do

  const now = new Date();
  const nextReview = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
  await tx.insert(riskProfileResponses).values({
    tenantId,
    investorId,
    finalCategory: category,
    totalScore: SCORE_BY_CATEGORY[category],
    signedAt: now,
    nextReviewAt: nextReview.toISOString().slice(0, 10),
    verificationMethod: "rm_entry",
    signedByName: signedByName ?? null,
    rmRemarks: "Category set directly (no questionnaire).",
    createdById: createdById ?? null,
  } as any);

  await tx
    .update(investors)
    .set({
      riskProfile: category,
      riskProfileScore: SCORE_BY_CATEGORY[category],
      riskProfileSignedAt: now,
      riskProfileVersion: sql`COALESCE(${investors.riskProfileVersion}, 0) + 1`,
      updatedAt: now,
    } as any)
    .where(and(eq(investors.id, investorId), eq(investors.tenantId, tenantId)));
}
