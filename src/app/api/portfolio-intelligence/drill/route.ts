import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/portfolio-intelligence/drill?by=amc|class&key=<label>&mine=1
 *
 * The investors behind one AMC or asset-class slice — turns a concentration bar
 * into an action list. Scoped to the firm, or the caller's own book with mine=1
 * (forced for non-owners). Returns the top 25 holders by value.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";

export const dynamic = "force-dynamic";

// Mirrors lib/portfolio/intelligence.ts classification (category + scheme name).
const CLASS_TEXT = `(COALESCE(NULLIF(s->>'category',''),'') || ' ' || COALESCE(s->>'schemeName',''))`;
const CLASS_CASE = `CASE
  WHEN ${CLASS_TEXT} ILIKE ANY (ARRAY['%liquid%','%overnight%','%money market%','%ultra short%','%ultra-short%']) THEN 'Liquid'
  WHEN ${CLASS_TEXT} ILIKE ANY (ARRAY['%debt%','%bond%','%gilt%','%g-sec%','%gsec%','%duration%','%income%','%credit risk%','% psu%','%banking & psu%','%banking and psu%','%floating%','%target maturity%','%fmp%','%fixed maturity%']) THEN 'Debt'
  WHEN ${CLASS_TEXT} ILIKE ANY (ARRAY['%hybrid%','%balanced%','%advantage%','%multi asset%','%multi-asset%','%arbitrage%','%equity savings%','%asset alloc%','%retirement%','%children%']) THEN 'Hybrid'
  WHEN ${CLASS_TEXT} ILIKE ANY (ARRAY['%gold%','%silver%','%commodit%']) THEN 'Commodity'
  WHEN ${CLASS_TEXT} ILIKE ANY (ARRAY['%internat%','%global%','%overseas%','%nasdaq%','%us equity%','%greater china%','%emerging market%']) THEN 'International'
  WHEN ${CLASS_TEXT} ILIKE ANY (ARRAY['%equity%','%elss%','%tax saver%','%large cap%','%large-cap%','%mid cap%','%mid-cap%','%small cap%','%small-cap%','%flexi%','%focus%','%value%','%contra%','%index%','%multi cap%','%multicap%','%bluechip%','%blue chip%','%business cycle%','%dividend yield%','%infrastructure%','%pharma%','%healthcare%','%technology%','%digital%','%consumption%','%manufacturing%','%momentum%','%quality%','%sectoral%','%thematic%','%nifty%','%sensex%','%etf%','%opportunit%','%special situation%','%mnc%','%esg%','%growth%']) THEN 'Equity'
  ELSE 'Other'
END`;

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const sp = req.nextUrl.searchParams;
    const by = sp.get("by") === "class" ? "class" : "amc";
    const key = (sp.get("key") ?? "").trim();
    if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });
    const canFirm = can(session.roles, "dashboard.view.owner", (session as any).permissions);
    const mine = sp.get("mine") === "1" || !canFirm;
    const scope = mine
      ? sql` AND i.deleted_at IS NULL AND i.rm_id = ${session.userId}::uuid`
      : sql` AND i.deleted_at IS NULL`;

    const holders = await withTenant(
      session.tenantId,
      async (tx) => {
        if (by === "amc") {
          return (await tx.execute(sql`
            SELECT i.id AS investor_id, i.name, COALESCE(SUM(f.aum::numeric),0)::numeric AS value
            FROM folios f JOIN investors i ON i.id = f.investor_id
            WHERE f.tenant_id = ${session.tenantId}::uuid AND f.amc_name = ${key} ${scope}
            GROUP BY i.id, i.name ORDER BY value DESC LIMIT 25
          `)).rows as any[];
        }
        return (await tx.execute(sql`
          SELECT i.id AS investor_id, i.name, COALESCE(SUM(COALESCE((s->>'value')::numeric,0)),0)::numeric AS value
          FROM folios f JOIN investors i ON i.id = f.investor_id, jsonb_array_elements(COALESCE(f.schemes,'[]'::jsonb)) s
          WHERE f.tenant_id = ${session.tenantId}::uuid AND ${sql.raw(CLASS_CASE)} = ${key} ${scope}
          GROUP BY i.id, i.name HAVING SUM(COALESCE((s->>'value')::numeric,0)) > 0 ORDER BY value DESC LIMIT 25
        `)).rows as any[];
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    const total = holders.reduce((a, h) => a + Number(h.value || 0), 0);
    return NextResponse.json({
      holders: holders.map((h) => ({
        investorId: h.investor_id,
        name: h.name,
        value: Number(h.value),
        pct: total > 0 ? Math.round((Number(h.value) / total) * 1000) / 10 : 0,
      })),
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
