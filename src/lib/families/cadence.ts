/**
 * Family review cadence — adopted from the Sanchay "Meeting Frequency" +
 * "First Meeting Date" fields. The frequency + first-meeting anchor together
 * drive `families.nextReviewAt`, which feeds the Command Center / Team
 * Dashboard "reviews due" and the review-cadence engine.
 */

export const FAMILY_REVIEW_FREQUENCIES = [
  ["monthly", "Monthly"],
  ["quarterly", "Quarterly"],
  ["half_yearly", "Half-yearly"],
  ["annual", "Annual"],
] as const;

const MONTHS: Record<string, number> = {
  monthly: 1,
  quarterly: 3,
  half_yearly: 6,
  annual: 12,
};

/**
 * Compute the next household review date from the first-meeting anchor + the
 * cadence. If the first meeting is in the future, that IS the next review;
 * otherwise advance by the cadence until the date is strictly in the future.
 * Returns null when either input is missing/invalid.
 */
export function computeFamilyNextReview(
  firstMeeting: string | Date | null | undefined,
  frequency: string | null | undefined,
  now = new Date()
): Date | null {
  if (!firstMeeting || !frequency) return null;
  const m = MONTHS[frequency];
  if (!m) return null;
  const d = new Date(firstMeeting);
  if (isNaN(d.getTime())) return null;
  let guard = 0;
  while (d <= now && guard < 1200) {
    d.setMonth(d.getMonth() + m);
    guard++;
  }
  return d;
}
