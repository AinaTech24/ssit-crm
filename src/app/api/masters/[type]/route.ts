import { handleApiError } from "@/lib/api/error-handler";
/**
 * Master values CRUD.
 *
 *   GET    /api/masters/[type]              — list values for a master type
 *   POST   /api/masters/[type]              — add a new value
 *   PATCH  /api/masters/[type]?key=X        — update a value
 *   DELETE /api/masters/[type]?key=X        — soft-deactivate (system defaults can't be deleted, only deactivated)
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { masterValues } from "@/db/schema";

export const dynamic = "force-dynamic";

const Body = z.object({
  key: z.string().min(1).max(80).regex(/^[a-z0-9_]+$/, "lowercase, underscore, numbers only"),
  label: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  sortOrder: z.number().int().optional(),
  meta: z.record(z.string(), z.any()).optional(),
  isActive: z.boolean().optional(),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  try {
    const session = await requireSession();
    const rows = await withTenant(session.tenantId, async (tx) => {
      return tx
        .select()
        .from(masterValues)
        .where(and(eq(masterValues.tenantId, session.tenantId), eq(masterValues.masterType, type as any)))
        .orderBy(asc(masterValues.sortOrder), asc(masterValues.label));
    });
    return NextResponse.json({ values: rows });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.masters", session.permissions);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });

    const id = uuid();
    await withTenant(session.tenantId, async (tx) => {
      await tx.insert(masterValues).values({
        id,
        tenantId: session.tenantId,
        masterType: type as any,
        key: parse.data.key,
        label: parse.data.label,
        description: parse.data.description,
        sortOrder: parse.data.sortOrder ?? 0,
        meta: parse.data.meta as any,
        isActive: parse.data.isActive ?? true,
        isSystemDefault: false,
      } as any);
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (err: any) {
    if (String(err?.message ?? "").includes("master_values_unique")) {
      return NextResponse.json({ error: "key already exists for this master type" }, { status: 409 });
    }
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  if (!key) return NextResponse.json({ error: "key query param required" }, { status: 400 });
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.masters", session.permissions);
    const body = await req.json().catch(() => ({}));
    await withTenant(session.tenantId, async (tx) => {
      await tx
        .update(masterValues)
        .set({
          label: body.label,
          description: body.description,
          sortOrder: body.sortOrder,
          meta: body.meta,
          isActive: body.isActive,
          updatedAt: new Date(),
        } as any)
        .where(
          and(
            eq(masterValues.tenantId, session.tenantId),
            eq(masterValues.masterType, type as any),
            eq(masterValues.key, key)
          )
        );
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  if (!key) return NextResponse.json({ error: "key query param required" }, { status: 400 });
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.masters", session.permissions);
    await withTenant(session.tenantId, async (tx) => {
      // System defaults: deactivate. Custom values: hard delete.
      const scope = and(
        eq(masterValues.tenantId, session.tenantId),
        eq(masterValues.masterType, type as any),
        eq(masterValues.key, key)
      );
      const existing = await tx.select().from(masterValues).where(scope).limit(1);
      if (!existing.length) return;
      if (existing[0].isSystemDefault) {
        await tx
          .update(masterValues)
          .set({ isActive: false, updatedAt: new Date() } as any)
          .where(scope);
      } else {
        await tx.delete(masterValues).where(scope);
      }
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
