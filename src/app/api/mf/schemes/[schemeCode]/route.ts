import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/mf/schemes/[schemeCode]
 *
 * One scheme's catalog row (mf_schemes + scheme_nav fallback) plus its recent
 * NAV history pulled live from mfapi.in (best-effort — empty if upstream is
 * unreachable). Used for the scheme detail / NAV trend view.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { getMfNavHistory } from "@/lib/finance/mfapi";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ schemeCode: string }> }) {
  const { schemeCode } = await params;
  try {
    const session = await requireSession();
    const code = String(schemeCode).replace(/[^0-9A-Za-z]/g, "").slice(0, 20);
    if (!code) return NextResponse.json({ error: "invalid scheme code" }, { status: 400 });

    const row = await withTenant(session.tenantId, async (tx) => {
      const r = await tx.execute(sql`
        SELECT m.scheme_code AS code, m.scheme_name AS name,
               COALESCE(m.fund_house, sn.amc_name) AS amc,
               m.scheme_type AS type, m.scheme_category AS category, m.isin AS isin,
               COALESCE(m.nav, sn.nav)::numeric AS nav,
               COALESCE(m.nav_date, sn.nav_date) AS nav_date
        FROM mf_schemes m
        LEFT JOIN scheme_nav sn ON sn.scheme_code = m.scheme_code
        WHERE m.scheme_code = ${code}
        LIMIT 1
      `);
      return (r.rows as any[])[0] ?? null;
    });

    const history = await getMfNavHistory(code, 60).catch(() => null);

    if (!row && !history) return NextResponse.json({ error: "scheme not found" }, { status: 404 });

    return NextResponse.json({
      scheme: row
        ? {
            schemeCode: row.code,
            schemeName: row.name,
            amc: row.amc,
            type: row.type,
            category: row.category,
            isin: row.isin,
            nav: row.nav != null ? Number(row.nav) : null,
            navDate: row.nav_date,
          }
        : { schemeCode: code, schemeName: history?.schemeName ?? code, amc: history?.fundHouse ?? null },
      history: history?.points ?? [],
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
