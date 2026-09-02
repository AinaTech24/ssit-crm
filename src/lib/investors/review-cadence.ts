/**
 * Review-cadence helpers — one source of truth for how a client's review
 * frequency turns into a "next review due" date.
 *
 * A client's cadence can be set two ways:
 *   1. A preset enum  — monthly / quarterly / half_yearly / annual (calendar
 *      months, so "quarterly" lands on the same day-of-month 3 months out).
 *   2. A custom number of DAYS — e.g. 50 or 100 — which overrides the preset.
 *
 * Pure functions, no server-only imports, so both the API routes and the
 * client-side editor component can use them.
 */

export type ReviewFrequency = "monthly" | "quarterly" | "half_yearly" | "annual";

export const PRESET_MONTHS: Record<ReviewFrequency, number> = {
  monthly: 1,
  quarterly: 3,
  half_yearly: 6,
  annual: 12,
};

/** Approximate day-count for a preset — used for display/sorting only. */
export const PRESET_DAYS: Record<ReviewFrequency, number> = {
  monthly: 30,
  quarterly: 90,
  half_yearly: 180,
  annual: 365,
};

export const PRESET_LABEL: Record<ReviewFrequency, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  half_yearly: "Half-yearly",
  annual: "Annual",
};

/**
 * Compute the next review date from a base date and a client's cadence.
 * Custom days win over the preset. Returns null when no cadence is set
 * (caller should then clear nextReviewAt so the client stops being nagged).
 */
export function computeNextReview(
  base: Date,
  reviewFrequency: ReviewFrequency | null | undefined,
  reviewFrequencyDays: number | null | undefined
): Date | null {
  if (reviewFrequencyDays && reviewFrequencyDays > 0) {
    const d = new Date(base);
    d.setDate(d.getDate() + reviewFrequencyDays);
    return d;
  }
  if (reviewFrequency && PRESET_MONTHS[reviewFrequency]) {
    const d = new Date(base);
    d.setMonth(d.getMonth() + PRESET_MONTHS[reviewFrequency]);
    return d;
  }
  return null;
}

/** Human label for the configured cadence, e.g. "Every 100 days" / "Quarterly". */
export function describeCadence(
  reviewFrequency: ReviewFrequency | null | undefined,
  reviewFrequencyDays: number | null | undefined
): string {
  if (reviewFrequencyDays && reviewFrequencyDays > 0) return `Every ${reviewFrequencyDays} days`;
  if (reviewFrequency && PRESET_LABEL[reviewFrequency]) return PRESET_LABEL[reviewFrequency];
  return "Not set";
}

/** True when a cadence (preset or custom) is configured. */
export function hasCadence(
  reviewFrequency: ReviewFrequency | null | undefined,
  reviewFrequencyDays: number | null | undefined
): boolean {
  return !!(reviewFrequencyDays && reviewFrequencyDays > 0) || !!reviewFrequency;
}
