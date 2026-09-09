/**
 * Family review propagation.
 *
 * A family is reviewed as a unit: the RM sits with the head of the family and
 * the whole household's portfolio is on the table. Recording that meeting
 * against the head only left every other member showing "review overdue",
 * which then fed the RM dashboard's overdue queues and the review nags.
 *
 * So when the HEAD's last-review date moves, the members move with it. The
 * reverse does not hold — reviewing one member says nothing about the family.
 *
 * Each member keeps its OWN cadence when the next date is recomputed: a
 * quarterly-reviewed member and an annually-reviewed one both get the head's
 * meeting date as `lastReviewAt`, but their own next-due dates.
 */

import { and, eq, isNull, ne } from "drizzle-orm";
import { investors, families } from "@/db/schema";
import { computeNextReview, type ReviewFrequency } from "./review-cadence";

/** What the propagation actually reads off a member row. */
type MemberCadence = {
  id: string;
  reviewFrequency: ReviewFrequency | null;
  reviewFrequencyDays: number | null;
};

/** Is this investor the head of their family? */
async function isFamilyHead(
  tx: any,
  tenantId: string,
  inv: { id: string; familyId: string | null; familyRole: string | null }
): Promise<boolean> {
  if (!inv.familyId) return false;
  const [fam] = await tx
    .select({ primaryInvestorId: families.primaryInvestorId })
    .from(families)
    .where(and(eq(families.id, inv.familyId), eq(families.tenantId, tenantId)))
    .limit(1);
  // The explicit pointer wins. Families created before it was set fall back to
  // the role marker, matching how the family pages resolve the primary.
  if (fam?.primaryInvestorId) return fam.primaryInvestorId === inv.id;
  return inv.familyRole === "self" || inv.familyRole === "head";
}

/**
 * Copy `lastReviewAt` from a family head onto every other member of the
 * family, recomputing each member's `nextReviewAt` from its own cadence.
 *
 * No-op (returns 0) when the investor has no family or is not its head.
 * Returns the number of members updated.
 */
export async function propagateFamilyReview(
  tx: any,
  tenantId: string,
  investorId: string,
  lastReviewAt: Date
): Promise<number> {
  const [inv] = (await tx
    .select({
      id: investors.id,
      familyId: investors.familyId,
      familyRole: investors.familyRole,
    })
    .from(investors)
    .where(and(eq(investors.id, investorId), eq(investors.tenantId, tenantId)))
    .limit(1)) as Array<{ id: string; familyId: string | null; familyRole: string | null }>;
  if (!inv?.familyId) return 0;
  if (!(await isFamilyHead(tx, tenantId, inv))) return 0;

  const members = (await tx
    .select({
      id: investors.id,
      reviewFrequency: investors.reviewFrequency,
      reviewFrequencyDays: investors.reviewFrequencyDays,
    })
    .from(investors)
    .where(
      and(
        eq(investors.tenantId, tenantId),
        eq(investors.familyId, inv.familyId),
        ne(investors.id, investorId),
        isNull(investors.deletedAt)
      )
    )) as MemberCadence[];

  let n = 0;
  for (const m of members) {
    const next = computeNextReview(lastReviewAt, m.reviewFrequency, m.reviewFrequencyDays);
    await tx
      .update(investors)
      .set({
        lastReviewAt,
        // A member with no cadence of its own simply has no next date — the
        // same rule the single-client path uses, rather than inventing one.
        ...(next ? { nextReviewAt: next } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(investors.id, m.id), eq(investors.tenantId, tenantId)));
    n++;
  }
  return n;
}

