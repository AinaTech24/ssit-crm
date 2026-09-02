import { handleApiError } from "@/lib/api/error-handler";
/**
 * PATCH  /api/branches/[id]  — partial update of a branch office
 * DELETE /api/branches/[id]  — delete (guarded: not HQ, no assigned users)
 *
 * Gated by `settings.users` (same cap the firm-profile page uses).
 */

import { NextRequest, NextResponse } from "next/server";
import { eq, and, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { branches, users } from "@/db/schema";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";

export const dynamic = "force-dynamic";

const AddressBody = z
  .object({
    line1: z.string().max(200).optional(),
    city: z.string().max(120).optional(),
    state: z.string().max(120).optional(),
    pincode: z.string().max(20).optional(),
  })
  .nullable()
  .optional();

const PatchBody = z.object({
  name: z.string().min(1).max(160).optional(),
  code: z.string().min(1).max(40).optional(),
  address: AddressBody,
  phone: z.string().max(40).nullable().optional(),
  email: z.string().email().nullable().optional().or(z.literal("")),
  headUserId: z.string().uuid().nullable().optional(),
  isHq: z.boolean().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.users", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const { id } = await params;

    const parse = PatchBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json(
        { error: "invalid body", issues: parse.error.issues },
        { status: 400 }
      );
    }
    const meta = clientMetaFromHeaders(req.headers);
    const body = parse.data;

    try {
      const result = await withTenant(session.tenantId, async (tx) => {
        const [existing] = await tx
          .select()
          .from(branches)
          .where(eq(branches.id, id));
        if (!existing) return null;

        const patch: any = { updatedAt: new Date() };
        if (body.name !== undefined) patch.name = body.name;
        if (body.code !== undefined) patch.code = body.code;
        if (body.address !== undefined) patch.address = body.address ?? null;
        if (body.phone !== undefined) patch.phone = body.phone || null;
        if (body.email !== undefined) patch.email = body.email || null;
        if (body.headUserId !== undefined)
          patch.headUserId = body.headUserId || null;
        if (body.isHq !== undefined) patch.isHq = body.isHq ? "true" : "false";

        const [next] = await tx
          .update(branches)
          .set(patch)
          .where(eq(branches.id, id))
          .returning();

        await recordAudit(tx, {
          tenantId: session.tenantId,
          actorUserId: session.userId,
          action: "branch.update",
          entityType: "branch",
          entityId: id,
          before: existing,
          after: next,
          ...meta,
        });
        return next;
      });

      if (!result)
        return NextResponse.json({ error: "not found" }, { status: 404 });
      return NextResponse.json({ branch: result });
    } catch (err: any) {
      const code = err?.code ?? err?.cause?.code;
      const msg = String(err?.message ?? "");
      if (code === "23505" || msg.includes("branches_tenant_code_unique")) {
        return NextResponse.json(
          { error: "A branch with that code already exists." },
          { status: 409 }
        );
      }
      throw err;
    }
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.users", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const { id } = await params;
    const meta = clientMetaFromHeaders(req.headers);

    const outcome = await withTenant(session.tenantId, async (tx) => {
      const [existing] = await tx
        .select()
        .from(branches)
        .where(eq(branches.id, id));
      if (!existing) return { kind: "not_found" as const };

      if (existing.isHq === "true") {
        return {
          kind: "blocked" as const,
          error: "You can't delete the HQ / registered office.",
        };
      }

      const [{ n }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(users)
        .where(
          and(eq(users.tenantId, session.tenantId), eq(users.branchId, id))
        );
      if (n > 0) {
        return {
          kind: "blocked" as const,
          error: `Reassign the ${n} team member${
            n === 1 ? "" : "s"
          } in this branch first.`,
        };
      }

      await tx.delete(branches).where(eq(branches.id, id));
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "branch.delete",
        entityType: "branch",
        entityId: id,
        before: existing,
        after: null,
        ...meta,
      });
      return { kind: "ok" as const };
    });

    if (outcome.kind === "not_found")
      return NextResponse.json({ error: "not found" }, { status: 404 });
    if (outcome.kind === "blocked")
      return NextResponse.json({ error: outcome.error }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
