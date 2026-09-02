/**
 * Persist-side glue for the deterministic lead scorer.
 *
 * `scoreFields()` (in ./score) gives you the columns to spread into an insert
 * or update when you already hold the row's values. `recomputeLeadScore()`
 * here is for the "I changed something, re-score this one lead by id" path —
 * it re-reads the canonical row inside the caller's transaction so the score
 * reflects committed state (stage, last contact, follow-up, amount), then
 * writes the three score columns back.
 *
 * Always call inside an existing `withTenant` tx so RLS scopes the read/write.
 */

import { eq } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { leads } from "@/db/schema";
import { scoreLead } from "./score";

/**
 * Re-score a single lead by id within the given transaction and persist the
 * result. Returns the new score/band, or null if the lead wasn't found
 * (e.g. RLS-scoped out or already deleted).
 */
export async function recomputeLeadScore(
  tx: Tx,
  leadId: string,
  now: number = Date.now()
): Promise<{ leadScore: number; scoreBand: string } | null> {
  const row = (await tx.select().from(leads).where(eq(leads.id, leadId)).limit(1))[0];
  if (!row) return null;

  const { score, band } = scoreLead(row as any, now);

  await tx
    .update(leads)
    .set({ leadScore: score, scoreBand: band, scoredAt: new Date(now) } as any)
    .where(eq(leads.id, leadId));

  return { leadScore: score, scoreBand: band };
}
