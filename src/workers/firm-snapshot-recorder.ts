/**
 * Daily firm-snapshot recorder.
 *
 * Once a day, writes one `firm_snapshots` row per tenant capturing that day's
 * AUM, active-client count, monthly SIP book and active-SIP count. AUM is a
 * point-in-time market value that can't be reconstructed retrospectively, so the
 * trend the copilot shows (get_aum_trend) accrues forward from the first run.
 *
 * Cross-tenant (system context) — one sweep, upsert keyed by (tenant_id, date)
 * so re-runs on the same day are idempotent.
 */

import { sql } from "drizzle-orm";
import { withSystem } from "@/db/client";

export async function recordDailySnapshots(): Promise<number> {
  return withSystem(async (tx) => {
    // Per-tenant client aggregates in one pass.
    const agg = await tx.execute(sql`
      SELECT t.id AS tenant_id,
        COALESCE(SUM(i.aum::numeric) FILTER (WHERE i.deleted_at IS NULL AND i.status <> 'closed' AND i.merged_into_id IS NULL), 0) AS total_aum,
        COUNT(i.id) FILTER (WHERE i.deleted_at IS NULL AND i.status <> 'closed' AND i.merged_into_id IS NULL)::int AS active_clients,
        COALESCE(SUM(i.active_sip_amount::numeric) FILTER (WHERE i.deleted_at IS NULL AND i.status <> 'closed' AND i.merged_into_id IS NULL), 0) AS monthly_sip
      FROM tenants t
      LEFT JOIN investors i ON i.tenant_id = t.id
      WHERE t.deleted_at IS NULL
      GROUP BY t.id
    `);

    // Active-SIP counts per tenant (separate table).
    const sips = await tx.execute(sql`
      SELECT tenant_id, COUNT(*) FILTER (WHERE status = 'active')::int AS active_sips
      FROM sips GROUP BY tenant_id
    `);
    const sipByTenant = new Map((sips.rows as Array<{ tenant_id: string; active_sips: number }>).map((r) => [r.tenant_id, Number(r.active_sips) || 0]));

    let written = 0;
    for (const r of agg.rows as Array<{ tenant_id: string; total_aum: string; active_clients: number; monthly_sip: string }>) {
      await tx.execute(sql`
        INSERT INTO firm_snapshots (tenant_id, snapshot_date, total_aum, active_clients, monthly_sip, active_sips)
        VALUES (${r.tenant_id}::uuid, current_date, ${Number(r.total_aum) || 0}, ${Number(r.active_clients) || 0}, ${Number(r.monthly_sip) || 0}, ${sipByTenant.get(r.tenant_id) ?? 0})
        ON CONFLICT (tenant_id, snapshot_date) DO UPDATE SET
          total_aum = EXCLUDED.total_aum,
          active_clients = EXCLUDED.active_clients,
          monthly_sip = EXCLUDED.monthly_sip,
          active_sips = EXCLUDED.active_sips
      `);
      written++;
    }
    return written;
  });
}
