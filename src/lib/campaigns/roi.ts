/**
 * Campaign ROI attribution.
 *
 * Turns the campaign's `meetingsBooked` / `clientsConverted` KPIs from a manual
 * guess into a real, evidence-backed number. Every campaign send writes a
 * `communications` row stamped with `campaign_id` + the subject (investor / lead),
 * so we can attribute downstream outcomes back to the people the campaign reached:
 *
 *   meetingsBooked   — review meetings booked by a contacted subject within the
 *                      attribution window after the campaign launched.
 *   clientsConverted — contacted LEADS that converted (became clients) within the
 *                      window. (Existing investors are already clients, so an
 *                      investor-segment campaign contributes 0 conversions — that
 *                      is correct, not a gap.)
 *
 * `leadsGenerated` stays manually editable — a broadcast to an existing audience
 * doesn't "generate" net-new leads in a way we can derive, so we don't invent it.
 *
 * Attribution is last-touch within a fixed window so a year-old campaign doesn't
 * keep claiming credit for unrelated activity forever.
 */

import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { campaigns } from "@/db/schema";

/** Days after launch during which a downstream outcome is credited to the campaign. */
export const ATTRIBUTION_WINDOW_DAYS = 30;

export interface CampaignRoi {
  meetingsBooked: number;
  clientsConverted: number;
}

/**
 * Recompute + persist attributed ROI for one campaign. Safe to call repeatedly
 * (idempotent — it overwrites with the freshly computed values). Returns the
 * computed figures. `leadsGenerated` is intentionally left untouched.
 */
export async function recomputeCampaignRoi(tx: Tx, tenantId: string, campaignId: string): Promise<CampaignRoi> {
  const win = `${ATTRIBUTION_WINDOW_DAYS} days`;

  const res = await tx.execute(sql`
    WITH anchor AS (
      SELECT COALESCE(started_at, created_at) AS t0
      FROM campaigns
      WHERE id = ${campaignId}::uuid AND tenant_id = ${tenantId}::uuid
    ),
    contacted AS (
      SELECT DISTINCT investor_id, lead_id
      FROM communications
      WHERE tenant_id = ${tenantId}::uuid
        AND campaign_id = ${campaignId}::uuid
        AND direction = 'outbound'
        AND status IN ('sent', 'delivered', 'read', 'replied')
    ),
    meetings AS (
      SELECT COUNT(DISTINCT rm.id) AS n
      FROM review_meetings rm, anchor a
      WHERE rm.tenant_id = ${tenantId}::uuid
        AND rm.created_at >= a.t0
        AND rm.created_at < a.t0 + ${win}::interval
        AND (
          (rm.investor_id IS NOT NULL AND rm.investor_id IN (SELECT investor_id FROM contacted WHERE investor_id IS NOT NULL))
          OR
          (rm.lead_id IS NOT NULL AND rm.lead_id IN (SELECT lead_id FROM contacted WHERE lead_id IS NOT NULL))
        )
    ),
    conversions AS (
      SELECT COUNT(DISTINCT l.id) AS n
      FROM leads l, anchor a
      WHERE l.tenant_id = ${tenantId}::uuid
        AND l.converted_at IS NOT NULL
        AND l.converted_at >= a.t0
        AND l.converted_at < a.t0 + ${win}::interval
        AND l.id IN (SELECT lead_id FROM contacted WHERE lead_id IS NOT NULL)
    )
    SELECT (SELECT n FROM meetings)::int AS meetings_booked,
           (SELECT n FROM conversions)::int AS clients_converted
  `);

  const row = (res.rows?.[0] ?? {}) as { meetings_booked?: number; clients_converted?: number };
  const out: CampaignRoi = {
    meetingsBooked: Number(row.meetings_booked ?? 0),
    clientsConverted: Number(row.clients_converted ?? 0),
  };

  await tx
    .update(campaigns)
    .set({ meetingsBooked: out.meetingsBooked, clientsConverted: out.clientsConverted, updatedAt: new Date() } as any)
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.tenantId, tenantId)));

  return out;
}
