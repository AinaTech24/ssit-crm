/**
 * Nightly goal recompute — SERVER-ONLY (imports DB).
 *
 * A goal's cached fields (required SIP, gap, progress, status) were only ever
 * computed at create/edit time, so they drifted: months tick down (required
 * SIP should rise), linked investments grow (progress should move), but nothing
 * refreshed them. And the goal_drift_alert recipe depends on
 * `expected_progress_pct`, which nothing populated. This recomputes everything
 * off live state so goal-based advice stays honest and the drift alert can fire.
 *
 * For each goal it:
 *   1. Re-derives current_value from linked folios (folio.aum × allocation),
 *      and existing_monthly_sip from linked active SIPs (amount × allocation)
 *      — when the goal links investments. Manually-entered values are kept when
 *      nothing is linked.
 *   2. Re-runs computeGoal() with the CURRENT months-remaining.
 *   3. Writes progress_pct, expected_progress_pct (time-elapsed trajectory),
 *      required_monthly_sip, gap_amount, and status.
 *
 * Lifecycle statuses set by a human (on_hold / abandoned) are preserved — only
 * the auto progress buckets (not_started/on_track/behind_track/achieved) move.
 */

import { inArray, eq } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { goals, folios, sips } from "@/db/schema";
import { computeGoal, monthsBetween } from "./calc";
import { effectiveGlideReturn } from "./glide-path";

/** Statuses a human owns — the nightly job never overwrites these. */
const MANUAL_STATUSES = new Set(["on_hold", "abandoned"]);

/**
 * Time-elapsed trajectory (0–100): how far along the goal SHOULD be by now,
 * purely on the calendar. Uses started_on (fallback createdAt) → target_date.
 */
export function expectedProgressPct(
  startedOn: Date | string | null | undefined,
  createdAt: Date | string | null | undefined,
  targetDate: Date | string,
  now: Date
): number {
  const start = startedOn ? new Date(startedOn) : createdAt ? new Date(createdAt) : now;
  const target = new Date(targetDate);
  const totalMonths = monthsBetween(start, target);
  if (totalMonths <= 0) return 100;
  const elapsed = monthsBetween(start, now);
  return Math.max(0, Math.min(100, (elapsed / totalMonths) * 100));
}

function allocFor(id: string, allocations: Array<{ folioId?: string; sipId?: string; allocationPct: number }> | null | undefined): number {
  const row = (allocations ?? []).find((a) => a.folioId === id || a.sipId === id);
  const pct = row?.allocationPct;
  return typeof pct === "number" && pct >= 0 && pct <= 100 ? pct : 100;
}

/**
 * Recompute every goal in the current tenant context (RLS scopes read/write).
 * Batched: two lookups for all linked folios/SIPs, then in-memory compute +
 * per-goal update. Returns counts by resulting status. Used by the nightly
 * scanner and the backfill script.
 */
export async function recomputeAllGoals(
  tx: Tx,
  now: Date = new Date()
): Promise<{ recomputed: number; onTrack: number; behind: number; achieved: number }> {
  return recomputeGoals(tx, now);
}

/** Recompute a single goal on demand (the "Recompute now" button). */
export async function recomputeOneGoal(tx: Tx, goalId: string, now: Date = new Date()) {
  return recomputeGoals(tx, now, goalId);
}

async function recomputeGoals(
  tx: Tx,
  now: Date,
  onlyGoalId?: string
): Promise<{ recomputed: number; onTrack: number; behind: number; achieved: number }> {
  const tally = { recomputed: 0, onTrack: 0, behind: 0, achieved: 0 };

  const all = onlyGoalId
    ? await tx.select().from(goals).where(eq(goals.id, onlyGoalId))
    : await tx.select().from(goals);
  if (all.length === 0) return tally;

  // Collect linked ids across all goals → two batched value lookups.
  const folioIds = new Set<string>();
  const sipIds = new Set<string>();
  for (const g of all) {
    for (const f of (g.linkedFolios as string[] | null) ?? []) folioIds.add(f);
    for (const s of (g.linkedSips as string[] | null) ?? []) sipIds.add(s);
  }

  const folioAum = new Map<string, number>();
  if (folioIds.size > 0) {
    const rows = await tx
      .select({ id: folios.id, aum: folios.aum })
      .from(folios)
      .where(inArray(folios.id, [...folioIds]));
    for (const r of rows) folioAum.set(r.id, Number(r.aum ?? 0));
  }

  // Only active SIPs contribute their monthly amount.
  const sipAmt = new Map<string, number>();
  if (sipIds.size > 0) {
    const rows = await tx
      .select({ id: sips.id, amount: sips.amount, status: sips.status })
      .from(sips)
      .where(inArray(sips.id, [...sipIds]));
    for (const r of rows) sipAmt.set(r.id, r.status === "active" ? Number(r.amount ?? 0) : 0);
  }

  for (const g of all) {
    const linkedFolios = (g.linkedFolios as string[] | null) ?? [];
    const linkedSips = (g.linkedSips as string[] | null) ?? [];

    // current_value from linked folios (× allocation) when any are linked,
    // otherwise keep the manually-entered value.
    let currentValue = Number(g.currentValue ?? 0);
    if (linkedFolios.length > 0) {
      currentValue = linkedFolios.reduce(
        (sum, fid) => sum + (folioAum.get(fid) ?? 0) * (allocFor(fid, g.folioAllocations as any) / 100),
        0
      );
    }

    // existing_monthly_sip from linked active SIPs when any are linked.
    let existingMonthlySip = Number(g.existingMonthlySip ?? g.monthlyContribution ?? 0);
    if (linkedSips.length > 0) {
      existingMonthlySip = linkedSips.reduce(
        (sum, sid) => sum + (sipAmt.get(sid) ?? 0) * (allocFor(sid, g.sipAllocations as any) / 100),
        0
      );
    }

    const monthsLeft = Math.max(0, monthsBetween(now, new Date(g.targetDate)));
    const futureTarget = Number(g.targetAmount);

    // Glide path tapers the effective return as the target nears — and because
    // this runs nightly with the CURRENT months-left, goals auto-de-risk over time.
    const baseReturn = g.expectedReturn != null ? Number(g.expectedReturn) : 12;
    const effReturn = effectiveGlideReturn(baseReturn, monthsLeft / 12, (g as any).glidePath);

    const calc = computeGoal({
      futureTarget,
      currentValue,
      existingMonthlySip,
      monthsLeft,
      expectedReturnPct: effReturn,
      inflationPct: g.inflationPct != null ? Number(g.inflationPct) : undefined,
      stepUpPct: g.stepUpPct != null ? Number(g.stepUpPct) : undefined,
    });

    const progressPct = futureTarget > 0 ? Math.min(100, (currentValue / futureTarget) * 100) : 0;
    const expProg = expectedProgressPct(g.startedOn, g.createdAt, g.targetDate, now);

    // Preserve human-owned lifecycle statuses.
    const nextStatus = MANUAL_STATUSES.has(g.status) ? g.status : calc.status;

    await tx
      .update(goals)
      .set({
        currentValue: currentValue.toFixed(2),
        existingMonthlySip: existingMonthlySip.toFixed(2),
        requiredMonthlySip: calc.requiredMonthlySipTotal.toFixed(2),
        gapAmount: calc.gapAmount.toFixed(2),
        progressPct: progressPct.toFixed(2),
        expectedProgressPct: expProg.toFixed(2),
        status: nextStatus as any,
        updatedAt: now,
      } as any)
      .where(inArray(goals.id, [g.id]));

    tally.recomputed++;
    if (nextStatus === "on_track") tally.onTrack++;
    else if (nextStatus === "behind_track") tally.behind++;
    else if (nextStatus === "achieved") tally.achieved++;
  }

  return tally;
}
