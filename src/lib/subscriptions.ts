/**
 * Research-subscription categories and renewal maths.
 *
 * Shared by the lead and client forms, the create/update APIs and the convert
 * route, so the three agree on what "subscribed" means and when it renews.
 */

export const SUBSCRIPTION_CATEGORIES = [
  { value: "non_subscribed", label: "Non-subscribed" },
  { value: "signed_up", label: "Signed up" },
  { value: "subscribed", label: "Subscribed" },
] as const;

export const SUBSCRIPTION_FREQUENCIES = [
  { value: "quarterly", label: "Quarterly", months: 3 },
  { value: "half_yearly", label: "Half-yearly", months: 6 },
  { value: "yearly", label: "Yearly", months: 12 },
] as const;

export type SubscriptionCategory = (typeof SUBSCRIPTION_CATEGORIES)[number]["value"];
export type SubscriptionFrequency = (typeof SUBSCRIPTION_FREQUENCIES)[number]["value"];

export function frequencyMonths(freq: string | null | undefined): number | null {
  return SUBSCRIPTION_FREQUENCIES.find((f) => f.value === freq)?.months ?? null;
}

function iso(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Add whole months to an ISO date, clamping 31 Jan + 1 month to 28/29 Feb. */
export function addMonthsISO(fromISO: string, months: number): string {
  const [y, m, d] = fromISO.slice(0, 10).split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return iso(target);
}

export function todayISO(): string {
  return iso(new Date());
}

/** The renewal date for a subscription that starts on `startISO`. */
export function renewalFrom(startISO: string, freq: string | null | undefined): string | null {
  const months = frequencyMonths(freq);
  return months ? addMonthsISO(startISO, months) : null;
}

/**
 * The next renewal after a renewal is taken: one period on from the date it was
 * DUE, not from today — paying a week late must not push every later renewal
 * out by a week — unless it has lapsed so long that stepping from the due date
 * would still be in the past, in which case it restarts from today.
 */
export function nextRenewal(dueISO: string | null, freq: string | null | undefined, today = todayISO()): string | null {
  const months = frequencyMonths(freq);
  if (!months) return null;
  let next = addMonthsISO(dueISO ?? today, months);
  while (next <= today) next = addMonthsISO(next, months);
  return next;
}

export function isSubscriptionCategory(v: unknown): v is SubscriptionCategory {
  return SUBSCRIPTION_CATEGORIES.some((c) => c.value === v);
}
export function isSubscriptionFrequency(v: unknown): v is SubscriptionFrequency {
  return SUBSCRIPTION_FREQUENCIES.some((f) => f.value === v);
}
