/**
 * POST   /api/settings/ui-layout   { moduleKey, kind, data }
 *   Save the firm-wide DEFAULT layout for a module (page-section order/visibility
 *   or table columns). Firm-admin only. Individual users still override locally.
 * DELETE /api/settings/ui-layout?moduleKey=..&kind=..
 *   Clear the firm default (fall back to the built-in default).
 *
 * The defaults are read server-side by the dashboard layout and injected as a
 * global, so there's no extra client fetch or layout flash.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { tenantUiLayouts } from "@/db/schema";
import { handleApiError } from "@/lib/api/error-handler";

export const dynamic = "force-dynamic";

const Body = z.object({
  moduleKey: z.string().min(1).max(80),
  kind: z.enum(["related_lists", "columns"]),
  // related_lists: { order: string[], hidden: string[] } · columns: string[]
  data: z.any(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.users", session.permissions); // firm-admin (owner) action
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const { moduleKey, kind, data } = parse.data;

    await withTenant(session.tenantId, async (tx) => {
      await tx
        .insert(tenantUiLayouts)
        .values({ tenantId: session.tenantId, moduleKey, kind, data, updatedBy: session.userId } as any)
        .onConflictDoUpdate({
          target: [tenantUiLayouts.tenantId, tenantUiLayouts.moduleKey, tenantUiLayouts.kind],
          set: { data, updatedBy: session.userId, updatedAt: new Date() },
        });
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.users", session.permissions);
    const moduleKey = req.nextUrl.searchParams.get("moduleKey") ?? "";
    const kind = req.nextUrl.searchParams.get("kind") ?? "";
    if (!moduleKey || !["related_lists", "columns"].includes(kind)) {
      return NextResponse.json({ error: "moduleKey and kind required" }, { status: 400 });
    }
    await withTenant(session.tenantId, async (tx) => {
      await tx.delete(tenantUiLayouts).where(
        and(eq(tenantUiLayouts.tenantId, session.tenantId), eq(tenantUiLayouts.moduleKey, moduleKey), eq(tenantUiLayouts.kind, kind as any))
      );
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
