/**
 * GET /api/investors/kpis — the 8-tile Clients KPI strip (mobile parity with the
 * web InvestorKpiStrip). Same SQL the web component runs: active-client counts,
 * AUM, SIP book, A-tier, reviews due, KYC expiring, nominee missing, dormant.
 * Soft-deleted clients are excluded so counts match the list.
 */

import { handleApiError } from "@/lib/api/error-handler";
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { assertModuleEnabled } from "@/lib/auth/license";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await requireSession();
    await assertModuleEnabled(session.tenantId, "client_master", session.roles);
    if (!can(session.roles, "investor.view.all", session.permissions) && !can(session.roles, "investor.view.assigned", session.permissions)) {
      return NextResponse.json({ error: "forbidden: missing investor.view" }, { status: 403 });
    }

    const data = await withTenant(
      session.tenantId,
      async (tx) => {
        const r = await tx.execute(sql`
          SELECT
            COUNT(*) FILTER (WHERE status = 'active')::int AS total_active,
            COUNT(*)::int AS total_all,
            COALESCE(SUM(aum::numeric) FILTER (WHERE status = 'active'), 0)::numeric AS total_aum,
            COALESCE(SUM(active_sip_amount::numeric) FILTER (WHERE status = 'active'), 0)::numeric AS sip_book,
            COUNT(*) FILTER (WHERE status = 'active' AND service_tier = 'A')::int AS tier_a,
            COUNT(*) FILTER (
              WHERE status = 'active' AND next_review_at IS NOT NULL AND next_review_at <= now()
            )::int AS reviews_due,
            COUNT(*) FILTER (
              WHERE status = 'active' AND (
                kyc_status IN ('expired', 're_kyc_required')
                OR (ckyc_expiry_at IS NOT NULL AND ckyc_expiry_at BETWEEN current_date AND current_date + interval '30 days')
              )
            )::int AS kyc_expiring,
            COUNT(*) FILTER (
              WHERE status = 'active' AND (nominee_name IS NULL OR nominee_name = '')
            )::int AS nominee_missing,
            COUNT(*) FILTER (
              WHERE status = 'active' AND (last_transaction_at IS NULL OR last_transaction_at < now() - make_interval(days => COALESCE((SELECT dormancy_window_days FROM tenants WHERE id = investors.tenant_id), 180)))
            )::int AS dormant
          FROM investors
          WHERE deleted_at IS NULL
        `);
        return (r.rows[0] ?? {}) as any;
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    const num = (v: unknown) => Number(v ?? 0);
    const totalActive = num(data.total_active);
    return NextResponse.json({
      totalActive,
      totalAll: num(data.total_all),
      totalAum: num(data.total_aum),
      sipBook: num(data.sip_book),
      tierA: num(data.tier_a),
      tierAPct: totalActive > 0 ? Math.round((num(data.tier_a) / totalActive) * 100) : 0,
      reviewsDue: num(data.reviews_due),
      kycExpiring: num(data.kyc_expiring),
      nomineeMissing: num(data.nominee_missing),
      dormant: num(data.dormant),
    });
  } catch (err) {
    return handleApiError(err);
  }
}
