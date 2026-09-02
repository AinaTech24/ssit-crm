import { handleApiError } from "@/lib/api/error-handler";
/**
 * Single announcement — PATCH (edit / pin / publish / expire) + DELETE.
 * Owners / branch heads only.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { ANNOUNCEMENT_CATEGORIES, announcements } from "@/db/schema";
import { audienceRolesSchema, checkBranchTarget } from "@/lib/announcements/validate";
import { notifyAnnouncementPublished } from "@/lib/announcements/notify";

export const dynamic = "force-dynamic";

const isManager = (roles: string[]) => roles.some((r) => ["owner", "branch_head"].includes(r));

const Patch = z.object({
  title: z.string().min(2).max(200).optional(),
  body: z.string().min(1).max(8000).optional(),
  category: z.enum(ANNOUNCEMENT_CATEGORIES).optional(),
  audienceRoles: audienceRolesSchema.optional(),
  branchId: z.string().uuid().nullable().optional(),
  isPinned: z.boolean().optional(),
  requiresAck: z.boolean().optional(),
  publishNow: z.boolean().optional(),
  unpublish: z.boolean().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    if (!isManager(session.roles)) return NextResponse.json({ error: "not allowed" }, { status: 403 });
    const parse = Patch.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const d = parse.data;
    const meta = clientMetaFromHeaders(req.headers);

    const result = await withTenant(session.tenantId, async (tx) => {
      const before = (await tx.select().from(announcements).where(and(eq(announcements.id, id), eq(announcements.tenantId, session.tenantId))).limit(1))[0];
      if (!before) return null;
      // Re-validate branch targeting when it's being changed.
      if (d.branchId !== undefined) {
        const branchErr = await checkBranchTarget(tx, {
          branchId: d.branchId,
          tenantId: session.tenantId,
          roles: session.roles,
          ownBranchId: session.branchId ?? null,
        });
        if (branchErr) return { error: branchErr };
      }
      const patch: any = { updatedAt: new Date() };
      if (d.title !== undefined) patch.title = d.title;
      if (d.body !== undefined) patch.body = d.body;
      if (d.category !== undefined) patch.category = d.category;
      if (d.audienceRoles !== undefined) patch.audienceRoles = d.audienceRoles;
      if (d.branchId !== undefined) patch.branchId = d.branchId;
      if (d.isPinned !== undefined) patch.isPinned = d.isPinned;
      if (d.requiresAck !== undefined) patch.requiresAck = d.requiresAck;
      if (d.expiresAt !== undefined) patch.expiresAt = d.expiresAt ? new Date(d.expiresAt) : null;
      if (d.publishNow) patch.publishedAt = new Date();
      if (d.unpublish) patch.publishedAt = null;
      const next = await tx
        .update(announcements)
        .set(patch)
        .where(and(eq(announcements.id, id), eq(announcements.tenantId, session.tenantId)))
        .returning();
      // Notify targeted staff only on the draft → published transition (not on
      // every edit of an already-live notice).
      if (d.publishNow && !before.publishedAt) {
        const n = next[0] as any;
        await notifyAnnouncementPublished(tx as any, session.tenantId, {
          id, title: n.title, category: n.category, audienceRoles: n.audienceRoles, branchId: n.branchId, createdByUserId: n.createdByUserId,
        });
      }
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "announcement.update",
        entityType: "announcement",
        entityId: id,
        after: d as any,
        ...meta,
      });
      return next[0];
    });
    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
    if ("error" in result && (result as any).error) {
      return NextResponse.json({ error: (result as any).error }, { status: 400 });
    }
    return NextResponse.json({ announcement: result });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    if (!isManager(session.roles)) return NextResponse.json({ error: "not allowed" }, { status: 403 });
    const meta = clientMetaFromHeaders(req.headers);
    const result = await withTenant(session.tenantId, async (tx) => {
      const before = (await tx.select().from(announcements).where(and(eq(announcements.id, id), eq(announcements.tenantId, session.tenantId))).limit(1))[0];
      if (!before) return null;
      await tx.delete(announcements).where(and(eq(announcements.id, id), eq(announcements.tenantId, session.tenantId)));
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "announcement.delete",
        entityType: "announcement",
        entityId: id,
        ...meta,
      });
      return before;
    });
    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
