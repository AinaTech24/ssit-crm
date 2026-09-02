/**
 * PATCH  /api/settings/custom-fields/[id]  — edit a definition (label/options/
 *   required/sort_order). DELETE removes it. Firm-admin only. (The key + entity
 *   are immutable so stored values stay addressable.)
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { customFieldDefs } from "@/db/schema";
import { handleApiError } from "@/lib/api/error-handler";

export const dynamic = "force-dynamic";

const PatchBody = z.object({
  label: z.string().min(1).max(80).optional(),
  options: z.array(z.string().min(1).max(80)).max(50).nullable().optional(),
  required: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireSession();
    requireCap(session.roles, "settings.users", session.permissions);
    const parse = PatchBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const patch: any = { updatedAt: new Date() };
    for (const k of ["label", "options", "required", "sortOrder"] as const) {
      if (parse.data[k] !== undefined) patch[k] = parse.data[k];
    }
    await withTenant(session.tenantId, async (tx) => {
      await tx.update(customFieldDefs).set(patch)
        .where(and(eq(customFieldDefs.id, id), eq(customFieldDefs.tenantId, session.tenantId)));
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireSession();
    requireCap(session.roles, "settings.users", session.permissions);
    await withTenant(session.tenantId, async (tx) => {
      await tx.delete(customFieldDefs).where(and(eq(customFieldDefs.id, id), eq(customFieldDefs.tenantId, session.tenantId)));
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
