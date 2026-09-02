/**
 * Persist-side glue for the family-health scorecard. SERVER-ONLY (imports DB).
 * The pure logic lives in ./health; this reads a family + its members and
 * writes the persisted health_score/health_band columns.
 *
 *   recomputeFamilyHealth(tx, familyId)        — one family by id
 *   recomputeFamilyHealthForInvestor(tx, id)   — the family an investor belongs
 *                                                to (no-op if unlinked)
 *   recomputeAllFamilyHealth(tx)               — every family in the tenant
 *                                                context (backfill + nightly)
 *
 * Family health depends on member aggregates (nominee/KYC/risk coverage,
 * next-gen, member count), so it must be recomputed whenever members are
 * linked/unlinked OR a member's relevant fields change — not just on family
 * edits. The nightly recompute-all also catches time-based drift (review
 * cadence).
 */

import { eq, isNotNull } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { families, investors } from "@/db/schema";
import { familyHealth, type MemberForHealth } from "./health";

/** Re-score one family by id and persist. Returns the new score/band, or null
 *  if the family wasn't found (RLS-scoped or deleted). */
export async function recomputeFamilyHealth(
  tx: Tx,
  familyId: string,
  now: Date = new Date()
): Promise<{ healthScore: number; healthBand: string } | null> {
  const fam = (await tx.select().from(families).where(eq(families.id, familyId)).limit(1))[0];
  if (!fam) return null;

  const members = await tx.select().from(investors).where(eq(investors.familyId, familyId));
  const { score, band } = familyHealth(fam as any, members as MemberForHealth[], now);

  await tx
    .update(families)
    .set({ healthScore: score, healthBand: band, healthScoredAt: now } as any)
    .where(eq(families.id, familyId));

  return { healthScore: score, healthBand: band };
}

/** Re-score the family an investor belongs to (if any). Call after editing a
 *  member's health-relevant fields. No-op when the investor is unlinked. */
export async function recomputeFamilyHealthForInvestor(
  tx: Tx,
  investorId: string,
  now: Date = new Date()
): Promise<void> {
  const row = (
    await tx.select({ familyId: investors.familyId }).from(investors).where(eq(investors.id, investorId)).limit(1)
  )[0];
  if (row?.familyId) await recomputeFamilyHealth(tx, row.familyId, now);
}

/**
 * Re-score every family in the current tenant context. Loads all families and
 * all linked members in two queries, buckets members by family in memory, and
 * updates each family — avoiding an N+1 member query per family. Returns counts
 * by band. Used by the backfill script and the nightly daily-ops scanner.
 */
export async function recomputeAllFamilyHealth(
  tx: Tx,
  now: Date = new Date()
): Promise<{ scored: number; green: number; amber: number; red: number }> {
  const tally = { scored: 0, green: 0, amber: 0, red: 0 };

  const fams = await tx.select().from(families);
  if (fams.length === 0) return tally;

  // All linked members in one shot, bucketed by family.
  const members = await tx.select().from(investors).where(isNotNull(investors.familyId));
  const byFamily = new Map<string, MemberForHealth[]>();
  for (const m of members as any[]) {
    const fid = m.familyId as string;
    const arr = byFamily.get(fid);
    if (arr) arr.push(m);
    else byFamily.set(fid, [m]);
  }

  for (const fam of fams) {
    const { score, band } = familyHealth(fam as any, byFamily.get(fam.id) ?? [], now);
    tally.scored++;
    (tally as any)[band]++;
    await tx
      .update(families)
      .set({ healthScore: score, healthBand: band, healthScoredAt: now } as any)
      .where(eq(families.id, fam.id));
  }

  return tally;
}
