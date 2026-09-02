import { handleApiError } from "@/lib/api/error-handler";
/**
 * Single-asset endpoints.
 *   GET    /api/content-library/[id]
 *   PATCH  /api/content-library/[id]   (platform admins only)
 *   DELETE /api/content-library/[id]   (soft = isActive=false; platform admins only)
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withPlatformAdmin, withSystem } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { isPlatformAdmin } from "@/lib/platform";
import { assetVisibleTo } from "@/lib/content/asset-url";
import {
  contentLibraryAssets,
  ASSET_CATEGORIES,
  ASSET_TYPES,
} from "@/db/schema";

export const dynamic = "force-dynamic";

const Patch = z
  .object({
    title: z.string().min(2).max(200).optional(),
    description: z.string().max(2000).optional(),
    type: z.enum(ASSET_TYPES).optional(),
    category: z.enum(ASSET_CATEGORIES).optional(),
    thumbnailUrl: z.string().url().optional(),
    tags: z.array(z.string().max(50)).optional(),
    isActive: z.boolean().optional(),
    publishAt: z.string().optional(),
    expireAt: z.string().optional(),
    brandingConfig: z
      .object({
        position: z.enum(["top", "bottom", "both"]).optional(),
        heightPct: z.number().min(5).max(50).optional(),
        background: z.string().optional(),
      })
      .optional(),
  })
  .strict();

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    const platformAdmin = isPlatformAdmin(session.roles);
    // withSystem bypasses RLS, so the visibility predicate is mandatory for
    // non-admins — without it any user could read any tenant's private asset by id.
    const row = await withSystem(async (tx) =>
      (
        await tx
          .select()
          .from(contentLibraryAssets)
          .where(platformAdmin ? eq(contentLibraryAssets.id, id) : and(eq(contentLibraryAssets.id, id), assetVisibleTo(session.tenantId)))
          .limit(1)
      )[0] ?? null
    );
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    // Hide the raw S3 URL from non-admin tenant users — they can only
    // fetch image assets through the branded endpoint.
    if (!isPlatformAdmin(session.roles) && row.type === "image") {
      return NextResponse.json({
        ...row,
        fileUrl: `/api/content-library/${row.id}/branded?mode=download`,
        thumbnailUrl: `/api/content-library/${row.id}/branded?mode=preview`,
      });
    }
    return NextResponse.json(row);
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    if (!isPlatformAdmin(session.roles)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const parse = Patch.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const patch: any = { ...parse.data, updatedAt: new Date() };
    if (patch.publishAt) patch.publishAt = new Date(patch.publishAt);
    if (patch.expireAt) patch.expireAt = new Date(patch.expireAt);
    await withPlatformAdmin(session.userId, async (tx) => {
      await tx.update(contentLibraryAssets).set(patch).where(eq(contentLibraryAssets.id, id));
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    if (!isPlatformAdmin(session.roles)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    // Default is a soft delete (deactivate, reversible). ?hard=1 permanently
    // removes the row — usage events cascade via the FK.
    const hard = new URL(req.url).searchParams.get("hard") === "1";
    await withPlatformAdmin(session.userId, async (tx) => {
      if (hard) {
        await tx.delete(contentLibraryAssets).where(eq(contentLibraryAssets.id, id));
      } else {
        await tx
          .update(contentLibraryAssets)
          .set({ isActive: false, updatedAt: new Date() } as any)
          .where(eq(contentLibraryAssets.id, id));
      }
    });
    return NextResponse.json({ ok: true, hard });
  } catch (err: any) {
    return handleApiError(err);
  }
}
