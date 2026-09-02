/**
 * EUIN validation — Employee Unique Identification Number per AMFI rules.
 *
 * Every executed mutual-fund transaction must carry an EUIN that points
 * to a *currently-certified* RM. AMFI's code says a missing or expired
 * EUIN voids the transaction (sale becomes "execution-only"); we treat
 * this as a hard block before we ever submit to the exchange.
 *
 * Rules enforced:
 *   1. EUIN must be present on the executing user
 *   2. The user must have a NISM certificate
 *   3. The NISM certificate must not be expired (compare to today)
 *   4. EUIN must look like a valid AMFI identifier (E + 6 digits)
 *
 * Usage in transaction create paths:
 *
 *   const check = await validateEuin(tx, executingUserId);
 *   if (!check.ok) {
 *     return NextResponse.json(
 *       { error: `Cannot place order: ${check.reason}` },
 *       { status: 422 }
 *     );
 *   }
 *
 * Returns { ok: true, euin } on success — caller persists `euin` onto
 * the transaction so the downstream BSE/NSE submission carries it.
 */

import { eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { users } from "@/db/schema";

const EUIN_PATTERN = /^E\d{6}$/;

export type EuinCheck =
  | { ok: true; euin: string; nismCategory: string | null; expiresAt: Date | null }
  | { ok: false; reason: string };

export async function validateEuin(tx: Tx, userId: string): Promise<EuinCheck> {
  const [u] = await tx
    .select({
      euin: users.euin,
      nismCertificateNo: users.nismCertificateNo,
      nismExpiryAt: users.nismExpiryAt,
      nismCategory: users.nismCategory,
      status: users.status,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!u) return { ok: false, reason: "Executing user not found" };
  if (u.status !== "active") {
    return { ok: false, reason: "Executing user is not active" };
  }
  if (!u.euin) {
    return { ok: false, reason: "RM has no EUIN on file — visit Settings → Employees" };
  }
  if (!EUIN_PATTERN.test(u.euin)) {
    return {
      ok: false,
      reason: `EUIN "${u.euin}" doesn't match expected format (E + 6 digits)`,
    };
  }
  if (!u.nismCertificateNo) {
    return { ok: false, reason: "RM has no NISM certificate on file" };
  }
  if (u.nismExpiryAt) {
    const expiresAt = new Date(u.nismExpiryAt);
    if (expiresAt < new Date()) {
      return {
        ok: false,
        reason: `RM's NISM certificate expired on ${expiresAt.toISOString().slice(0, 10)} — renew before placing orders`,
      };
    }
  }

  return {
    ok: true,
    euin: u.euin,
    nismCategory: u.nismCategory ?? null,
    expiresAt: u.nismExpiryAt ? new Date(u.nismExpiryAt) : null,
  };
}

/** SQL helper version — for use inside the transaction commit path. */
export async function validateEuinSql(
  tx: Tx,
  userId: string
): Promise<EuinCheck> {
  return validateEuin(tx, userId);
}
