/**
 * GET  /api/dashboards          → { mine, shared, deleted } board lists
 * POST /api/dashboards          → create a board { name, description?, layout?, scope? }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { handleApiError } from "@/lib/api/error-handler";
import { listBoards, createBoard, type Actor } from "@/lib/dashboards/service";
import { sanitizeLayout } from "@/lib/dashboards/widgets";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireSession();
    const actor: Actor = { userId: session.userId, roles: session.roles ?? [] };
    const data = await withTenant(session.tenantId, async (tx) => listBoards(tx, session.tenantId, actor));
    return NextResponse.json(data);
  } catch (err) {
    return handleApiError(err);
  }
}

const CreateBody = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(500).optional(),
  scope: z.enum(["private", "shared"]).optional(),
  layout: z.array(z.any()).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const actor: Actor = { userId: session.userId, roles: session.roles ?? [] };
    const parsed = CreateBody.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "invalid input", issues: parsed.error.issues }, { status: 400 });

    const board = await withTenant(session.tenantId, async (tx) =>
      createBoard(tx, session.tenantId, actor, {
        name: parsed.data.name,
        description: parsed.data.description,
        scope: parsed.data.scope,
        layout: sanitizeLayout(parsed.data.layout) as any,
      })
    );
    return NextResponse.json({ id: board.id }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
