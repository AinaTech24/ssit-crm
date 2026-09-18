/**
 * Gift intimations — to the owning RM, and to the gifting desk.
 *
 * Three moments matter, and they are deliberately different messages:
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
 *   notifyGiftLogged()      — "an RM just logged this, it needs a price and a
 *       delivery date" — sent to the gifting desk, who own those two fields.
 *
 * All three take an open transaction so the write is atomic with whatever
 * triggered it, and all three no-op when there is nobody to tell — a
 * notification with no recipient is not an error worth failing a write over.
 */

import { sql } from "drizzle-orm";
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

/**
 * "An RM logged a gift — it needs finishing off."
 *
 * The RM records what was given; the gifting desk owns the two fields the RM
 * usually can't fill at that moment: the PRICE and the DELIVERY DATE. Without
 * this the desk had to notice new rows by re-reading the log, so a gift could
 * sit unpriced and undelivered indefinitely.
 *
 * Addressed by DESK, not by name. The desk is:
 *
 *   - anyone carrying the Gifting / HR role, plus
 *   - anyone explicitly granted `gifting.manage` on their own user record.
 *
 * Deliberately NOT "everyone the RBAC matrix would let manage gifting" — that
 * set also contains the owner, ops, back office and every assistant, who can
 * open the board but don't run it, and would get a ping per gift forever.
 * Naming the two individuals instead would break the day either changes desk;
 * a role plus an explicit grant survives that and is what Settings already
 * edits.
 *
 * The body names only what is actually outstanding, so a gift logged complete
 * doesn't generate a chase for nothing.
 */
export async function notifyGiftLogged(
  tx: any,
  g: GiftIntimation & { loggedByUserId: string; loggedByName?: string | null }
): Promise<number> {
  const needsPrice = !g.amount || Number(g.amount) <= 0;
  const needsDelivery = !g.onDate;
  if (!needsPrice && !needsDelivery) return 0;

  const desk = (
    await tx.execute(sql`
      SELECT id FROM users
      WHERE tenant_id = ${g.tenantId}::uuid
        AND status = 'active'
        AND id <> ${g.loggedByUserId}::uuid
        AND (
          'gifting_hr' = ANY(roles)
          OR COALESCE(permissions, '[]'::jsonb) @> '"gifting.manage"'::jsonb
        )
    `)
  ).rows as Array<{ id: string }>;
  if (desk.length === 0) return 0;

  const outstanding = [needsPrice ? "a price" : "", needsDelivery ? "a delivery date" : ""]
    .filter(Boolean)
    .join(" and ");

  for (const u of desk) {
    await createNotification(tx, {
      tenantId: g.tenantId,
      userId: u.id,
      kind: "gift.logged",
      title: `Gift logged for ${g.clientName} — needs ${outstanding}`,
      body: `${g.loggedByName ? `${g.loggedByName} logged ` : "Logged: "}${g.giftTitle} for ${g.clientName}. Add ${outstanding} to close it off.`,
      linkUrl: `/dashboard/engagement`,
      severity: "info",
      meta: {
        giftId: g.giftId ?? null,
        investorId: g.investorId,
        giftTitle: g.giftTitle,
        needsPrice,
        needsDelivery,
      },
    });
  }
  return desk.length;
}
