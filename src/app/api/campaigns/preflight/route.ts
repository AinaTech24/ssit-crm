import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/campaigns/preflight?segmentId=&channel=
 *
 * Pre-launch sanity checks surfaced in the campaign builder:
 *   recipients      — current live size of the chosen segment
 *   recentOverlap   — campaigns sent to the SAME segment in the last 14 days
 *                     (fatigue / accidental re-send warning)
 *   waOutsideWindow — for WhatsApp: how many recipients are OUTSIDE the 24h
 *                     session window, so a marketing template send to them is
 *                     likely to be skipped (helps set expectations before launch)
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { segments, segmentMemberships } from "@/db/schema";

export const dynamic = "force-dynamic";

const OVERLAP_WINDOW_DAYS = 14;

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "campaign.send", session.permissions);
    const url = new URL(req.url);
    const segmentId = url.searchParams.get("segmentId") ?? "";
    const channel = (url.searchParams.get("channel") ?? "").toLowerCase();
    if (!segmentId) return NextResponse.json({ error: "segmentId required" }, { status: 400 });

    const data = await withTenant(session.tenantId, async (tx) => {
      const [seg] = await tx
        .select()
        .from(segments)
        .where(and(eq(segments.id, segmentId), eq(segments.tenantId, session.tenantId)))
        .limit(1);
      if (!seg) return null;

      const [{ recipients }] = await tx
        .select({ recipients: sql<number>`count(*)::int` })
        .from(segmentMemberships)
        .where(
          and(
            eq(segmentMemberships.segmentId, segmentId),
            eq(segmentMemberships.tenantId, session.tenantId),
            sql`${segmentMemberships.removedAt} IS NULL`
          )
        );

      // Recent campaigns that targeted this same segment (overlap / fatigue).
      const overlapRes = await tx.execute(sql`
        SELECT name, channel, COALESCE(started_at, scheduled_at, created_at) AS when_ts
        FROM campaigns
        WHERE tenant_id = ${session.tenantId}::uuid
          AND segment_id = ${segmentId}::uuid
          AND status IN ('scheduled', 'sending', 'sent')
          AND COALESCE(started_at, scheduled_at, created_at) >= now() - ${`${OVERLAP_WINDOW_DAYS} days`}::interval
        ORDER BY when_ts DESC
        LIMIT 5
      `);

      // WhatsApp 24h-window estimate: members WITHOUT an inbound WA message in the
      // last 24h can't receive a marketing template until they re-open the window.
      let waOutsideWindow: number | null = null;
      if (channel === "whatsapp") {
        const subjCol = seg.subjectType === "lead" ? sql`c.lead_id` : sql`c.investor_id`;
        const res = await tx.execute(sql`
          WITH active AS (
            SELECT DISTINCT sm.subject_id
            FROM segment_memberships sm
            JOIN communications c
              ON ${subjCol} = sm.subject_id
             AND c.tenant_id = ${session.tenantId}::uuid
             AND c.channel = 'whatsapp'
             AND c.direction = 'inbound'
             AND c.created_at >= now() - interval '24 hours'
            WHERE sm.segment_id = ${segmentId}::uuid
              AND sm.tenant_id = ${session.tenantId}::uuid
              AND sm.removed_at IS NULL
          )
          SELECT (SELECT count(*) FROM active)::int AS active_n
        `);
        const activeN = Number((res.rows?.[0] as any)?.active_n ?? 0);
        waOutsideWindow = Math.max(0, Number(recipients ?? 0) - activeN);
      }

      return {
        recipients: Number(recipients ?? 0),
        recentOverlap: (overlapRes.rows ?? []).map((r: any) => ({ name: r.name, channel: r.channel, when: r.when_ts })),
        waOutsideWindow,
      };
    });

    if (!data) return NextResponse.json({ error: "segment not found" }, { status: 404 });
    return NextResponse.json(data);
  } catch (err: any) {
    return handleApiError(err);
  }
}
