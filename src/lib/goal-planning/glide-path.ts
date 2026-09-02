/**
 * Goal glide-path / de-risking. As a goal approaches its target date, a prudent
 * plan shifts from equity toward debt — so the *effective* expected return used
 * for the required-SIP math should taper down, not stay at (say) 12% with one
 * year left. This keeps `computeGoal` itself untouched (its math is test-pinned)
 * — callers just feed it an effective return derived here.
 */

export type GlidePath = "none" | "conservative" | "moderate" | "aggressive";

export const GLIDE_PATH_LABELS: Record<GlidePath, string> = {
  none: "None (return held)",
  conservative: "Conservative (de-risk from 7y)",
  moderate: "Moderate (de-risk from 5y)",
  aggressive: "Aggressive (de-risk from 3y)",
};

// Each profile: years-before-target where de-risking begins, and how many
// percentage points are shaved off the base return by the target date.
const CONFIG: Record<Exclude<GlidePath, "none">, { startYears: number; shavePts: number }> = {
  conservative: { startYears: 7, shavePts: 6 },
  moderate: { startYears: 5, shavePts: 4 },
  aggressive: { startYears: 3, shavePts: 2 },
};

/**
 * Effective expected return % for a goal with `yearsLeft` to run under a glide
 * path. Linearly tapers the base return from the start year down to
 * (base − shave) at the target date, floored at 4% (a debt-like minimum).
 */
export function effectiveGlideReturn(baseReturnPct: number, yearsLeft: number, glide: GlidePath | null | undefined): number {
  const g = (glide ?? "none") as GlidePath;
  if (g === "none" || !Number.isFinite(yearsLeft) || yearsLeft <= 0) return baseReturnPct;
  const cfg = CONFIG[g as Exclude<GlidePath, "none">];
  if (!cfg || yearsLeft >= cfg.startYears) return baseReturnPct;
  const frac = (cfg.startYears - yearsLeft) / cfg.startYears; // 0 at start → 1 at target
  return Math.max(4, baseReturnPct - cfg.shavePts * frac);
}
