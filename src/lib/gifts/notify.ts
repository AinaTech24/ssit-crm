/**
 * Gift intimations to the owning RM.
 *
 * Two moments matter, and they are deliberately different messages:
 *
 *   notifyGiftDelivered()   — "this reached the client" — sent once, when the
 *       gift is marked delivered. The RM is usually not the person who ships
 *       it, but they are the person who speaks to the client next, so they
 *       cannot be the last to know.
 *
 *   notifyGiftAnniversary() — "you sent this a year ago" — sent by the daily
 *       scanner so the RM plans this year's gift instead of rediscovering last
 *       year's in the log, or worse, repeating it.
 *
 * Both take an open transaction so the write is atomic with whatever triggered
 * it, and both no-op when the client has no RM — a notification with no
 * recipient is not an error worth failing a delivery over.
 */

import { createNotification } from "@/lib/notifications/create";

export type GiftIntimation = {
  tenantId: string;
  /** Lets the notification be removed when the gift is deleted. */
  giftId?: string | null;
  /** The client's owning RM. Null/undefined = nobody to tell; no-op. */
  rmId: string | null | undefined;
  investorId: string;
  clientName: string;
  giftTitle: string;
  amount?: number | null;
  /** yyyy-mm-dd */
  onDate: string;
};

function rupees(amount: number | null | undefined): string {
  if (amount == null || amount <= 0) return "";
  return ` (₹${Number(amount).toLocaleString("en-IN", { maximumFractionDigits: 0 })})`;
}

function pretty(date: string): string {
  const d = new Date(`${String(date).slice(0, 10)}T00:00:00`);
  return isNaN(d.getTime())
    ? String(date)
    : d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
}

/** "The gift reached the client." Fired once per delivery. */
export async function notifyGiftDelivered(tx: any, g: GiftIntimation): Promise<boolean> {
  if (!g.rmId) return false;
  await createNotification(tx, {
    tenantId: g.tenantId,
    userId: g.rmId,
    kind: "gift.delivered",
    title: `Gift delivered to ${g.clientName}`,
    body: `${g.giftTitle}${rupees(g.amount)} was delivered on ${pretty(g.onDate)}. Worth a call.`,
    linkUrl: `/dashboard/investors/${g.investorId}`,
    severity: "success",
    meta: { giftId: g.giftId ?? null, investorId: g.investorId, giftTitle: g.giftTitle, deliveredOn: g.onDate },
  });
  return true;
}

/** "A year ago you sent this." Fired by the daily scanner. */
export async function notifyGiftAnniversary(tx: any, g: GiftIntimation): Promise<boolean> {
  if (!g.rmId) return false;
  await createNotification(tx, {
    tenantId: g.tenantId,
    userId: g.rmId,
    kind: "gift.anniversary",
    title: `A year since ${g.clientName}'s gift`,
    body: `Last year on ${pretty(g.onDate)} you sent ${g.giftTitle}${rupees(g.amount)}. Time to plan this year's — and pick something different.`,
    linkUrl: `/dashboard/investors/${g.investorId}`,
    severity: "info",
    meta: { giftId: g.giftId ?? null, investorId: g.investorId, giftTitle: g.giftTitle, previousOn: g.onDate },
  });
  return true;
}
