/**
 * GET /api/dashboard/widgets/[key]?rm=<uuid>
 *
 * Returns the data + render config for a single dashboard widget. Tenant-scoped
 * via withTenant (RLS). `rm` optionally narrows widgets that support an RM cut.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { handleApiError } from "@/lib/api/error-handler";
import { WIDGET_SQL } from "@/lib/dashboards/widget-sql";
import { WIDGET_META_BY_KEY } from "@/lib/dashboards/widgets";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest, ctx: { params: Promise<{ key: string }> }) {
  try {
    const session = await requireSession();
    const { key } = await ctx.params;
    const def = WIDGET_SQL[key];
    const meta = WIDGET_META_BY_KEY[key];
    if (!def || !meta) return NextResponse.json({ error: "unknown widget" }, { status: 404 });

    const rmParam = new URL(req.url).searchParams.get("rm") ?? "";
    const rmId = meta.supportsRm && UUID.test(rmParam) ? rmParam : undefined;

    const rows = await withTenant(session.tenantId, async (tx) => {
      const res = await tx.execute(def.run(sql, { rmId }));
      return res.rows as any[];
    });

    return NextResponse.json({ key, title: meta.title, type: meta.type, view: def.view, rows });
  } catch (err) {
    return handleApiError(err);
  }
}
