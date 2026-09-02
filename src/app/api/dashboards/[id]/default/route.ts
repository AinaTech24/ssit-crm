import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { handleApiError } from "@/lib/api/error-handler";
import { getBoard, setDefaultBoard, canView, type Actor } from "@/lib/dashboards/service";

export const dynamic = "force-dynamic";

/** POST /api/dashboards/[id]/default → set this board as the user's home default. */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await ctx.params;
    const actor: Actor = { userId: session.userId, roles: session.roles ?? [] };
    const ok = await withTenant(session.tenantId, async (tx) => {
      const board = await getBoard(tx, session.tenantId, id);
      if (!board || board.deletedAt || !canView(board, actor)) return false;
      await setDefaultBoard(tx, session.tenantId, actor, id);
      return true;
    });
    if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
