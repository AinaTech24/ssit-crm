import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/mf/amcs
 *
 * The tenant's AMC catalogue (amc_master) — { code, name } pairs for AMC
 * pickers (e.g. the AMC Empanelment form). Web pages read this table via a
 * server component; the mobile app has no server render, so it needs an API.
 */

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireSession();
    const amcs = await withTenant(session.tenantId, async (tx) => {
      const r = await tx.execute(sql`
        SELECT code, name
        FROM amc_master
        WHERE tenant_id = ${session.tenantId}::uuid AND is_active = true
        ORDER BY name
      `);
      return r.rows;
    });
    return NextResponse.json({ amcs });
  } catch (err) {
    return handleApiError(err);
  }
}
