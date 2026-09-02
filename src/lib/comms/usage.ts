/**
 * Per-tenant monthly messaging quota.
 *
 * The in-memory rate limiter (rate-limit.ts) only caps per-MINUTE bursts and
 * resets on process restart — it does NOT bound a tenant's total spend over a
 * billing period. WhatsApp / SMS are real per-message costs, so without a
 * period cap a single tenant could run up unbounded channel cost.
 *
 * The cap is read from the tenant's plan: `packages.feature_flags`
 * → `maxMessagesPerMonth` (a single allowance across all outbound channels).
 * Absent / 0 / falsy ⇒ unlimited (no overhead beyond the cheap lookup).
 * Authentication/OTP sends are exempt (same policy as the rate limiter).
 *
 * Counting window is the current calendar month (UTC). We count outbound
 * communications that actually went out (anything not skipped_* / failed).
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";

export type QuotaCheck = { allowed: true } | { allowed: false; used: number; cap: number };

/**
 * Returns whether this tenant may send one more billable message this month.
 * `tx` is already tenant-scoped (RLS), so the reads are tenant-local.
 */
export async function checkMonthlyQuota(
  tx: Tx,
  tenantId: string,
  category: "transactional" | "utility" | "marketing" | "authentication"
): Promise<QuotaCheck> {
  // Auth/OTP must never be quota-blocked (locking a user out of login is worse
  // than the marginal cost).
  if (category === "authentication") return { allowed: true };

  // Resolve the plan's monthly allowance via the tenant's subscription.
  const capRow = (
    await tx.execute(sql`
      SELECT COALESCE((p.feature_flags->>'maxMessagesPerMonth')::int, 0) AS cap
      FROM subscriptions s
      JOIN packages p ON p.id = s.package_id
      WHERE s.tenant_id = ${tenantId}::uuid
      LIMIT 1
    `)
  ).rows[0] as { cap?: number } | undefined;

  const cap = Number(capRow?.cap ?? 0);
  if (!cap || cap <= 0) return { allowed: true }; // unlimited / unconfigured

  const usedRow = (
    await tx.execute(sql`
      SELECT count(*)::int AS used
      FROM communications
      WHERE tenant_id = ${tenantId}::uuid
        AND direction = 'outbound'
        AND created_at >= date_trunc('month', now())
        AND status NOT LIKE 'skipped_%'
        AND status <> 'failed'
    `)
  ).rows[0] as { used?: number } | undefined;

  const used = Number(usedRow?.used ?? 0);
  if (used >= cap) return { allowed: false, used, cap };
  return { allowed: true };
}
