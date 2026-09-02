/**
 * GET    /api/dashboards/[id]  → a single board (must be viewable)
 * PATCH  /api/dashboards/[id]  → update name/description/scope/locked/layout/filters (editor)
 * DELETE /api/dashboards/[id]  → soft delete → Recently Deleted
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { handleApiError } from "@/lib/api/error-handler";
import { getBoard, updateBoard, softDeleteBoard, canView, canEdit, type Actor } from "@/lib/dashboards/service";
import { sanitizeLayout } from "@/lib/dashboards/widgets";

export const dynamic = "force-dynamic";

function actorOf(s: { userId: string; roles?: string[] }): Actor {
  return { userId: s.userId, roles: s.roles ?? [] };
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await ctx.params;
    const actor = actorOf(session);
    const board = await withTenant(session.tenantId, async (tx) => getBoard(tx, session.tenantId, id));
    if (!board || board.deletedAt) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (!canView(board, actor)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    return NextResponse.json({ board, canEdit: canEdit(board, actor) });
  } catch (err) {
    return handleApiError(err);
  }
}

const PatchBody = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
  scope: z.enum(["private", "shared"]).optional(),
  locked: z.boolean().optional(),
  layout: z.array(z.any()).optional(),
  filters: z.object({ period: z.string().optional(), rm: z.string().optional() }).nullable().optional(),
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await ctx.params;
    const actor = actorOf(session);
    const parsed = PatchBody.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "invalid input", issues: parsed.error.issues }, { status: 400 });

    const result = await withTenant(session.tenantId, async (tx) => {
      const board = await getBoard(tx, session.tenantId, id);
      if (!board || board.deletedAt) return { status: 404 as const };
      if (!canEdit(board, actor)) return { status: 403 as const };
      // A locked shared board edited by a non-creator is refused (creator/owner ok).
      if (board.locked && board.userId !== actor.userId && !actor.roles.includes("owner")) return { status: 403 as const };

      const patch: any = {};
      if (parsed.data.name !== undefined) patch.name = parsed.data.name;
      if (parsed.data.description !== undefined) patch.description = parsed.data.description;
      if (parsed.data.scope !== undefined) patch.scope = parsed.data.scope;
      if (parsed.data.locked !== undefined) patch.locked = parsed.data.locked;
      if (parsed.data.filters !== undefined) patch.filters = parsed.data.filters;
      if (parsed.data.layout !== undefined) patch.layout = sanitizeLayout(parsed.data.layout);
      await updateBoard(tx, id, patch);
      return { status: 200 as const };
    });
    if (result.status !== 200) return NextResponse.json({ error: result.status === 404 ? "not found" : "forbidden" }, { status: result.status });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await ctx.params;
    const actor = actorOf(session);
    const result = await withTenant(session.tenantId, async (tx) => {
      const board = await getBoard(tx, session.tenantId, id);
      if (!board || board.deletedAt) return 404 as const;
      if (!canEdit(board, actor)) return 403 as const;
      await softDeleteBoard(tx, id);
      return 200 as const;
    });
    if (result !== 200) return NextResponse.json({ error: result === 404 ? "not found" : "forbidden" }, { status: result });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
