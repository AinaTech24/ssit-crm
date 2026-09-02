/**
 * Soft-delete retention — how long a soft-deleted tenant (with all its data)
 * is kept before it's eligible for automatic permanent purge. Stored in the
 * platform_settings key/value store so the platform admin can change it without
 * a redeploy; defaults to 30 days.
 */

import { sql } from "drizzle-orm";

export const RETENTION_KEY = "tenant_retention";
export const DEFAULT_SOFT_DELETE_RETENTION_DAYS = 30;

type Tx = { execute: (q: any) => Promise<{ rows: any[] }> };

/** Read the configured soft-delete retention (days). Falls back to the default. */
export async function readSoftDeleteRetentionDays(tx: Tx): Promise<number> {
  try {
    const r = await tx.execute(sql`SELECT value FROM platform_settings WHERE key = ${RETENTION_KEY} LIMIT 1`);
    const v = (r.rows[0] as any)?.value;
    const days = Number(v?.softDeleteDays);
    if (Number.isFinite(days) && days >= 1 && days <= 3650) return Math.round(days);
  } catch {
    /* table/row missing → default */
  }
  return DEFAULT_SOFT_DELETE_RETENTION_DAYS;
}
