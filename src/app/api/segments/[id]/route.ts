import { handleApiError } from "@/lib/api/error-handler";
/**
 * Single segment endpoints.
 *
 *   GET    /api/segments/[id]   — fetch one segment
 *   PATCH  /api/segments/[id]   — update name/description/filter AST
 *   DELETE /api/segments/[id]   — hard delete (cascades memberships)
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { segments } from "@/db/schema";
import { FilterASTSchema } from "@/lib/filter/ast";
import { compileToSelect } from "@/lib/filter/compiler";

export const dynamic = "force-dynamic";

const Patch = z.object({
  name: z.string().min(2).max(200).optional(),
  description: z.string().optional(),
  // The column is `ast` (not `filterAst`), and it must be a valid FilterAST —
  // the previous `filterAst: z.any()` both wrote to a non-existent column AND
  // skipped validation, so edits silently no-op'd or saved un-compilable ASTs.
  ast: FilterASTSchema.optional(),
  kind: z.enum(["static", "dynamic"]).optional(),
  refreshCron: z.string().max(120).optional(),
  materializerEnabled: z.boolean().optional(),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    const row = await withTenant(session.tenantId, async (tx) =>
      (await tx.select().from(segments).where(and(eq(segments.id, id), eq(segments.tenantId, session.tenantId))).limit(1))[0] ?? null
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
    requireCap(session.roles, "segments.manage", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = Patch.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const updates = parse.data;
    const clientMeta = clientMetaFromHeaders(req.headers);

    // Load the existing segment first — we need its subjectType to compile-check
    // a new AST, and to 404 cleanly.
    const existing = await withTenant(session.tenantId, async (tx) =>
      (await tx.select().from(segments).where(and(eq(segments.id, id), eq(segments.tenantId, session.tenantId))).limit(1))[0] ?? null
    );
    if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

    // A new AST must compile against the segment's subject before we save it —
    // otherwise the materializer would throw on this segment every tick.
    if (updates.ast !== undefined) {
      try {
        compileToSelect(updates.ast, existing.subjectType, { limit: 1 });
      } catch (e: any) {
        return NextResponse.json({ error: `AST does not compile: ${e?.message ?? e}` }, { status: 400 });
      }
    }

    const next: Record<string, unknown> = { updatedAt: new Date() };
    if (updates.name !== undefined) next.name = updates.name;
    if (updates.description !== undefined) next.description = updates.description;
    if (updates.ast !== undefined) next.ast = updates.ast;
    if (updates.kind !== undefined) next.kind = updates.kind;
    if (updates.refreshCron !== undefined) next.refreshCron = updates.refreshCron;
    if (updates.materializerEnabled !== undefined) next.materializerEnabled = updates.materializerEnabled;

    const result = await withTenant(session.tenantId, async (tx) => {
      const r = await tx
        .update(segments)
        .set(next as any)
        .where(and(eq(segments.id, id), eq(segments.tenantId, session.tenantId)))
        .returning();
      if (!r[0]) return null;
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "segment.update",
        entityType: "segment",
        entityId: id,
        after: { name: r[0].name, astChanged: updates.ast !== undefined } as any,
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
    requireCap(session.roles, "segments.manage", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const clientMeta = clientMetaFromHeaders(req.headers);
    await withTenant(session.tenantId, async (tx) => {
      const before = (await tx.select().from(segments).where(and(eq(segments.id, id), eq(segments.tenantId, session.tenantId))).limit(1))[0];
      if (!before) return;
      await tx.delete(segments).where(and(eq(segments.id, id), eq(segments.tenantId, session.tenantId)));
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "segment.delete",
        entityType: "segment",
        entityId: id,
        before: { name: before.name } as any,
        ...clientMeta,
      });
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
