/**
 * The two-firm-admin rule.
 *
 * A firm runs TWO admins — a principal and a second pair of hands — each with
 * their own email and their own password. Never a shared login, and never a
 * third: `owner` bypasses the whole capability matrix (see the short-circuit in
 * can()), so every holder is someone who can do anything to the firm's data.
 *
 * There was already a LOWER bound (you cannot remove the last active owner —
 * that would leave a firm nobody can administer). This is the upper bound,
 * which nothing enforced: invite and role-change could each add a third.
 *
 * Counting ACTIVE owners only is what makes hand-over work: offboard the
 * outgoing admin, then promote the incoming one. A suspended or offboarded
 * owner cannot sign in, so they do not hold a seat.
 *
 * NOT retrospective. A firm that already has three owners keeps them — silently
 * demoting a real person's access is not a rule's decision to make. The cap
 * stops the next one, and the firm can offboard the extra themselves.
 */

import { sql } from "drizzle-orm";

type Tx = { execute: (q: any) => Promise<{ rows: unknown[] }> };

/** Firm admins a tenant may have at once. */
export const MAX_FIRM_ADMINS = 2;

/** Active owners in the tenant, optionally ignoring the user being edited. */
export async function activeOwnerCount(tx: Tx, tenantId: string, exceptId?: string): Promise<number> {
  const r = await tx.execute(
    exceptId
      ? sql`SELECT COUNT(*)::int AS c FROM users
             WHERE tenant_id = ${tenantId}::uuid AND id <> ${exceptId}::uuid
               AND status = 'active' AND deleted_at IS NULL AND 'owner' = ANY(roles)`
      : sql`SELECT COUNT(*)::int AS c FROM users
             WHERE tenant_id = ${tenantId}::uuid
               AND status = 'active' AND deleted_at IS NULL AND 'owner' = ANY(roles)`
  );
  return Number((r.rows[0] as { c?: number } | undefined)?.c ?? 0);
}

/** Shown wherever the cap blocks something — says what to do instead. */
export const MAX_FIRM_ADMINS_MESSAGE =
  `A firm can have ${MAX_FIRM_ADMINS} admins. Give this person a different role, or ` +
  `offboard one of the current admins first.`;

/**
 * True when adding one more owner would exceed the cap.
 * `exceptId` is the user being changed, so promoting someone who is ALREADY an
 * owner does not count them twice.
 */
export async function wouldExceedFirmAdminCap(
  tx: Tx,
  tenantId: string,
  exceptId?: string
): Promise<boolean> {
  return (await activeOwnerCount(tx, tenantId, exceptId)) >= MAX_FIRM_ADMINS;
}
