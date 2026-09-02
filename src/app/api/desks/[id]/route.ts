/**
 * PATCH  /api/desks/[id]  → rename / re-code a desk { name?, code? }
 * DELETE /api/desks/[id]  → delete a desk (members are unassigned)
 *
 * Gated by settings.desks.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { updateDesk, deleteDesk } from "@/lib/org/desks";

export const dynamic = "force-dynamic";

const PatchBody = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  code: z.string().trim().max(20).nullish(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.desks", session.permissions);
    const { id } = await params;
    const parsed = PatchBody.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid input", issues: parsed.error.issues }, { status: 400 });
    }
    await withTenant(session.tenantId, async (tx) => updateDesk(tx, id, parsed.data));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.desks", session.permissions);
    const { id } = await params;
    await withTenant(session.tenantId, async (tx) => deleteDesk(tx, id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
