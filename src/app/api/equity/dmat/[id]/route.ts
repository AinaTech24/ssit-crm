/**
 * PATCH  /api/equity/dmat/[id] → update a DMAT account
 * DELETE /api/equity/dmat/[id] → delete a DMAT account
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { updateDmat, deleteDmat } from "@/lib/equity/service";

export const dynamic = "force-dynamic";

const PatchBody = z.object({
  clientName: z.string().trim().min(1).max(160).optional(),
  dmatNumber: z.string().trim().max(60).nullish(),
  broker: z.string().trim().max(80).nullish(),
  openedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  closedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  status: z.enum(["active", "dormant", "closed"]).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["reports.business", "reports.manage"], session.permissions);
    const { id } = await params;
    const parsed = PatchBody.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "invalid input", issues: parsed.error.issues }, { status: 400 });
    await withTenant(session.tenantId, async (tx) => updateDmat(tx, id, parsed.data));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["reports.business", "reports.manage"], session.permissions);
    const { id } = await params;
    await withTenant(session.tenantId, async (tx) => deleteDmat(tx, id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
