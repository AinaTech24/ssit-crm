import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { handleApiError } from "@/lib/api/error-handler";
import { getBoard, cloneBoard, canView, type Actor } from "@/lib/dashboards/service";

export const dynamic = "force-dynamic";

/** POST /api/dashboards/[id]/clone → duplicate a viewable board into a private copy. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await ctx.params;
    const actor: Actor = { userId: session.userId, roles: session.roles ?? [] };
    const body = await req.json().catch(() => ({}));
    const res = await withTenant(session.tenantId, async (tx) => {
      const src = await getBoard(tx, session.tenantId, id);
      if (!src || src.deletedAt || !canView(src, actor)) return null;
      return cloneBoard(tx, session.tenantId, actor, src, typeof body?.name === "string" ? body.name : undefined);
    });
    if (!res) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ id: res.id }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
