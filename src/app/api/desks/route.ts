/**
 * GET  /api/desks  → { branches, desks, members } — the desk board
 * POST /api/desks  → create a desk { branchId, name, code? }
 *
 * Gated by settings.desks (owner + branch_head + ops/back-office).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { loadDeskBoard, createDesk } from "@/lib/org/desks";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.desks", session.permissions);
    const data = await withTenant(session.tenantId, async (tx) => loadDeskBoard(tx));
    return NextResponse.json(data);
  } catch (err) {
    return handleApiError(err);
  }
}

const CreateBody = z.object({
  branchId: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  code: z.string().trim().max(20).nullish(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.desks", session.permissions);
    const parsed = CreateBody.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid input", issues: parsed.error.issues }, { status: 400 });
    }
    const row = await withTenant(session.tenantId, async (tx) =>
      createDesk(tx, session.tenantId, parsed.data)
    );
    return NextResponse.json({ id: row.id }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
