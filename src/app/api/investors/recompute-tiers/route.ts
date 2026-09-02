import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/investors/recompute-tiers
 *
 * Owner-only. Recomputes service_tier for every active investor in this
 * tenant using the AUM-percentile + segment rules. Manually-overridden
 * tiers are skipped.
 *
 * Run on-demand from the UI; also wired to the nightly tier-recomputer
 * worker for continuous freshness.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.masters", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);

    const clientMeta = clientMetaFromHeaders(req.headers);
    const result = await withTenant(session.tenantId, async (tx) => {
      // Compute the AUM percentile cut-offs for this tenant
      const cuts = await tx.execute(sql`
        SELECT
          percentile_cont(0.80) WITHIN GROUP (ORDER BY aum::numeric ASC)::numeric AS p80,
          percentile_cont(0.50) WITHIN GROUP (ORDER BY aum::numeric ASC)::numeric AS p50
        FROM investors WHERE status = 'active'
      `);
      const c = cuts.rows[0] as any;
      const p80 = Number(c.p80 ?? 0);
      const p50 = Number(c.p50 ?? 0);

      // Apply tier rules in one UPDATE so it's fast even at 5K clients
      const updated = await tx.execute(sql`
        UPDATE investors SET
          service_tier = CASE
            WHEN service_tier_manual_override = true THEN service_tier
            WHEN segment_tag = 'HNI' THEN 'A'
            WHEN segment_tag = 'Affluent' THEN 'B'
            WHEN segment_tag = 'NRI' AND aum::numeric >= ${p80} THEN 'A'
            WHEN aum::numeric >= ${p80} THEN 'A'
            WHEN aum::numeric >= ${p50} THEN 'B'
            ELSE 'C'
          END,
          service_tier_locked_at = CASE
            WHEN service_tier_manual_override = true THEN service_tier_locked_at
            ELSE now()
          END,
          updated_at = now()
        WHERE status = 'active'
        RETURNING id, service_tier
      `);

      const counts = (updated.rows as any[]).reduce<Record<string, number>>((acc, r) => {
        acc[r.service_tier] = (acc[r.service_tier] ?? 0) + 1;
        return acc;
      }, {});

      const r = {
        recomputed: updated.rows.length,
        p80Cutoff: p80,
        p50Cutoff: p50,
        counts,
      };
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "investor.tier.recompute",
        entityType: "investor",
        entityId: null,
        meta: r,
        ...clientMeta,
      });
      return r;
    });
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
