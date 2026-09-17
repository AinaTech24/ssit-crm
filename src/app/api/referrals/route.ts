/**
 * GET /api/referrals — JSON feed for the mobile Referral Tracking screen.
 *
 * Mirrors the web /dashboard/referrals RSC: per-referrer roll-up (leads given,
 * converted, in-pipeline, lost, converted AUM), a headline summary, and the
 * "advocates to ask" list (best clients who've never referred). Read-only.
 */

import { handleApiError } from "@/lib/api/error-handler";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { investorScopeSql } from "@/lib/investors/access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    // Carries client names/phones — require an investor view capability.
    requireAny(session.roles, ["investor.view.all", "investor.view.assigned"], session.permissions);

    // Filters (mirror the web /dashboard/referrals page): name search + a
    // "top referrers (2+)" toggle. Only the referrers TABLE is filtered — the
    // headline summary + advocates stay firm-wide.
    const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
    const minTwo = req.nextUrl.searchParams.get("min") === "2";

    const data = await withTenant(session.tenantId, async (tx) => {
      // The web /dashboard/referrals page only grants investor.view.all
      // (firm-wide roles), so it never needed a wall — but this mobile feed
      // also allows investor.view.assigned (plain RM/sub_broker/ria/…), and
      // had NO rm_id/service_rm_id/branch filter anywhere: an RM using the
      // mobile app saw every referrer, every advocate and firm-wide converted
      // AUM. Scope every query to the same wall the web Clients list uses.
      const scope = await investorScopeSql(tx, session, "i");
      const nameFilter = q ? sql` AND i.name ILIKE ${`%${q}%`}` : sql``;
      const havingFilter = minTwo ? sql`HAVING COUNT(l.id) >= 2` : sql``;
      const rows = await tx.execute(sql`
        SELECT
          i.id AS referrer_id,
          i.name AS referrer_name,
          i.phone AS referrer_phone,
          i.email AS referrer_email,
          i.segment_tag,
          i.service_tier,
          COUNT(l.id)::int AS leads_given,
          COUNT(l.id) FILTER (WHERE l.converted_investor_id IS NOT NULL)::int AS converted,
          COUNT(l.id) FILTER (
            WHERE l.converted_investor_id IS NULL AND l.stage NOT IN ('lost','not_interested')
          )::int AS in_pipeline,
          COUNT(l.id) FILTER (WHERE l.stage IN ('lost','not_interested'))::int AS lost,
          COALESCE(SUM(inv.aum::numeric), 0)::numeric AS converted_aum
        FROM investors i
        JOIN leads l ON l.referred_by_investor_id = i.id
        LEFT JOIN investors inv ON inv.id = l.converted_investor_id
        WHERE i.deleted_at IS NULL AND ${scope}${nameFilter}
        GROUP BY i.id, i.name, i.phone, i.email, i.segment_tag, i.service_tier
        ${havingFilter}
        ORDER BY leads_given DESC, converted DESC
        LIMIT 200
      `);

      const summary = await tx.execute(sql`
        SELECT
          COUNT(DISTINCT i.id)::int AS active_referrers,
          COUNT(l.id)::int AS total_referrals,
          COUNT(l.id) FILTER (WHERE l.converted_investor_id IS NOT NULL)::int AS total_converted,
          ROUND(100.0 * COUNT(l.id) FILTER (WHERE l.converted_investor_id IS NOT NULL)
            / NULLIF(COUNT(l.id), 0), 1) AS conversion_pct,
          COALESCE(SUM(inv.aum::numeric), 0)::numeric AS converted_aum
        FROM investors i
        JOIN leads l ON l.referred_by_investor_id = i.id
        LEFT JOIN investors inv ON inv.id = l.converted_investor_id
        WHERE i.deleted_at IS NULL AND ${scope}
      `);

      const advocates = await tx.execute(sql`
        SELECT i.id, i.name, i.phone, COALESCE(i.aum, 0)::numeric AS aum, i.service_tier, i.last_contact_at
        FROM investors i
        LEFT JOIN leads l ON l.referred_by_investor_id = i.id
        WHERE i.status = 'active'
          AND i.deleted_at IS NULL
          AND i.redemption_risk_flagged_at IS NULL
          AND ${scope}
        GROUP BY i.id, i.name, i.phone, i.aum, i.service_tier, i.last_contact_at
        HAVING COUNT(l.id) = 0
        ORDER BY i.aum DESC NULLS LAST
        LIMIT 8
      `);

      return {
        referrers: rows.rows as any[],
        summary: (summary.rows[0] ?? {}) as any,
        advocates: advocates.rows as any[],
      };
    });

    return NextResponse.json(data);
  } catch (err) {
    return handleApiError(err);
  }
}
