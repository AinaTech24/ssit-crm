import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/mf/schemes?q=<text>&limit=<n>
 *
 * Search the platform-shared Mutual Fund scheme catalog (mf_schemes, synced
 * daily from mfapi.in), falling back to scheme_nav (AMFI feed) for NAV / AMC.
 * This is the single source the app uses wherever a scheme or AMC is picked.
 * Any authenticated tenant user may read it (RLS: catalog is read-all).
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { deriveSchemeRisk } from "@/lib/mf/scheme-risk";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") ?? "").trim().replace(/[%_]/g, " ");
    const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit")) || 20));
    if (q.length < 2) return NextResponse.json({ schemes: [] });
    const pat = `%${q}%`;

    const rows = await withTenant(session.tenantId, async (tx) => {
      // scheme_nav (AMFI feed) is the always-populated universe of schemes;
      // mf_schemes (mfapi catalog) enriches it with scheme_category as it syncs.
      // Querying scheme_nav-primary means the picker works immediately on deploy
      // even before the daily mfapi sync has run.
      const r = await tx.execute(sql`
        SELECT sn.scheme_code AS code,
               sn.scheme_name AS name,
               COALESCE(m.fund_house, sn.amc_name) AS amc,
               m.scheme_category AS category,
               COALESCE(m.nav, sn.nav)::numeric AS nav,
               COALESCE(m.nav_date, sn.nav_date) AS nav_date
        FROM scheme_nav sn
        LEFT JOIN mf_schemes m ON m.scheme_code = sn.scheme_code
        WHERE sn.scheme_name ILIKE ${pat} OR sn.amc_name ILIKE ${pat}
        ORDER BY length(sn.scheme_name) ASC, sn.scheme_name ASC
        LIMIT ${limit}
      `);
      return r.rows as Array<{
        code: string; name: string; amc: string | null;
        category: string | null; nav: string | null; nav_date: string | null;
      }>;
    });

    return NextResponse.json({
      schemes: rows.map((r) => ({
        schemeCode: r.code,
        schemeName: r.name,
        amc: r.amc,
        category: r.category,
        nav: r.nav != null ? Number(r.nav) : null,
        navDate: r.nav_date,
        // SEBI riskometer band derived from the scheme category (mfapi has no
        // official riskometer field). null when it can't be inferred.
        risk: deriveSchemeRisk(r.category, r.name),
      })),
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
