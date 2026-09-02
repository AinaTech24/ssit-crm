import { handleApiError } from "@/lib/api/error-handler";
/**
 * Single SOP endpoints.
 *
 *   GET    /api/sops/[id]   — fetch one SOP
 *   PATCH  /api/sops/[id]   — update title/category/required roles
 *   DELETE /api/sops/[id]   — hard delete (cascades to sop_versions)
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, ASSIGNABLE_ROLES } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { sops } from "@/db/schema";

export const dynamic = "force-dynamic";

const ASSIGNABLE = new Set<string>(ASSIGNABLE_ROLES);

const Patch = z.object({
  title: z.string().min(2).max(200).optional(),
  category: z.string().optional(),
  requiredRoles: z
    .array(z.string())
    .optional()
    .refine((rs) => rs === undefined || rs.every((r) => ASSIGNABLE.has(r)), {
      message: "requiredRoles must be assignable tenant roles",
    }),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    const row = await withTenant(session.tenantId, async (tx) =>
      (await tx
        .select()
        .from(sops)
        .where(and(eq(sops.id, id), eq(sops.tenantId, session.tenantId), isNull(sops.deletedAt)))
        .limit(1))[0] ?? null
    );
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(row);
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "sop.manage", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = Patch.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const clientMeta = clientMetaFromHeaders(req.headers);

    const result = await withTenant(session.tenantId, async (tx) => {
      const r = await tx
        .update(sops)
        .set({ ...parse.data, updatedAt: new Date() } as any)
        .where(and(eq(sops.id, id), eq(sops.tenantId, session.tenantId), isNull(sops.deletedAt)))
        .returning();
      if (!r[0]) return null;
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "sop.update",
        entityType: "sop",
        entityId: id,
        after: parse.data as any,
        ...clientMeta,
      });
      return r[0];
    });
    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "sop.manage", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const clientMeta = clientMetaFromHeaders(req.headers);
    const ok = await withTenant(session.tenantId, async (tx) => {
      // Soft-delete: stamp deleted_at instead of hard-deleting. A hard delete
      // would cascade away every sop_versions row and orphan the
      // sop_acknowledgements (no FK), destroying the sign-off evidence this
      // module exists to keep for DDQ / inspection. Versions + acks are retained.
      const r = await tx
        .update(sops)
        .set({ deletedAt: new Date(), deletedBy: session.userId, updatedAt: new Date() } as any)
        .where(and(eq(sops.id, id), eq(sops.tenantId, session.tenantId), isNull(sops.deletedAt)))
        .returning({ id: sops.id });
      if (!r[0]) return false;
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "sop.delete",
        entityType: "sop",
        entityId: id,
        ...clientMeta,
      });
      return true;
    });
    if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
