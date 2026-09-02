/**
 * Monotonic delivery-status application for provider webhooks.
 *
 * WhatsApp/email lifecycle is sent → delivered → read → replied, but provider
 * webhooks routinely arrive OUT OF ORDER (a late "delivered" after a "read",
 * a stray "sent" after a terminal "bounced"). A blind `SET status = <new>`
 * would regress the lifecycle or resurrect a terminal failure.
 *
 * This helper:
 *   - advances `status` only when the incoming event ranks HIGHER than the
 *     stored one (so read never falls back to delivered);
 *   - always stamps the event's timestamp via COALESCE (a real "delivered"
 *     event still records delivered_at even if status stays "read");
 *   - records a failure reason only on failed/bounced;
 *   - reports whether the status actually advanced, so callers only emit
 *     downstream events (outbox) on a genuine transition — not on a duplicate
 *     or out-of-order webhook.
 *
 * It runs as a single statement with `SELECT … FOR UPDATE` so concurrent
 * webhooks for the same message can't interleave a stale read+write.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";

/** Lifecycle ordering. Higher wins. Terminal negatives sit above the positive
 *  delivery path so a late positive event can't overwrite them. */
export const STATUS_RANK: Record<string, number> = {
  queued: 1,
  sent: 2,
  delivered: 3,
  read: 4,
  replied: 5,
  bounced: 6,
  failed: 6,
  unsubscribed: 7,
  cancelled: 7,
};

const TS_FIELD: Record<string, string> = {
  sent: "sent_at",
  delivered: "delivered_at",
  read: "read_at",
  replied: "replied_at",
  failed: "failed_at",
  bounced: "failed_at",
};

/** CASE mapping a given status column to its rank. Fixed literal — no user input. */
function rankCase(col: string): string {
  return `CASE ${col} ${Object.entries(STATUS_RANK)
    .map(([s, r]) => `WHEN '${s}' THEN ${r}`)
    .join(" ")} ELSE 0 END`;
}

export interface ApplyStatusResult {
  tenantId: string;
  id: string;
  status: string;
  /** True only when this event moved the row forward in the lifecycle. */
  advanced: boolean;
}

/**
 * Apply a provider status to the matching communications row(s), monotonically.
 * Returns the affected row(s) with an `advanced` flag, or [].
 */
export async function applyMonotonicStatus(
  tx: Tx,
  opts: { externalId: string; channel: "whatsapp" | "email" | "sms"; newStatus: string; reason?: string | null }
): Promise<ApplyStatusResult[]> {
  const { externalId, channel, newStatus, reason } = opts;
  if (!externalId) return [];
  const newRank = STATUS_RANK[newStatus] ?? 0;
  const tsCol = TS_FIELD[newStatus]; // may be undefined (e.g. 'queued') → no stamp
  const tsAssign = tsCol ? sql`, ${sql.raw(tsCol)} = COALESCE(${sql.raw(tsCol)}, now())` : sql``;

  const res = await tx.execute(sql`
    WITH cur AS (
      SELECT id, status AS old_status
      FROM communications
      WHERE external_id = ${externalId} AND channel = ${channel}
      FOR UPDATE
    )
    UPDATE communications AS c
    SET status = CASE WHEN (${sql.raw(rankCase("cur.old_status"))}) < ${newRank} THEN ${newStatus} ELSE c.status END
        ${tsAssign},
        status_reason = CASE WHEN ${newStatus} IN ('failed', 'bounced') THEN ${reason ?? null} ELSE c.status_reason END,
        updated_at = now()
    FROM cur
    WHERE c.id = cur.id
    RETURNING c.tenant_id AS "tenantId", c.id AS id, c.status AS status, cur.old_status AS "oldStatus"
  `);

  return (res.rows ?? []).map((r: any) => ({
    tenantId: r.tenantId,
    id: r.id,
    status: r.status,
    advanced: (STATUS_RANK[r.oldStatus as string] ?? 0) < newRank,
  }));
}
