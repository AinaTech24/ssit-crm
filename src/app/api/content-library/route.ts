import { handleApiError } from "@/lib/api/error-handler";
/**
 * Equitywala Content Library — platform-shared and tenant-specific.
 *
 *   GET  /api/content-library         — list active assets (any logged-in user)
 *   POST /api/content-library         — register an asset (Equitywala platform admins and MFD admins/marketing)
 *   POST /api/content-library/upload-url — presigned S3 PUT (Equitywala and MFD admins/marketing)
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { desc } from "drizzle-orm";
import { z } from "zod";
import { withPlatformAdmin, withSystem, withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { isPlatformAdmin } from "@/lib/platform";
import { can } from "@/lib/auth/rbac";
import { assetVisibleTo, isUnsafeAssetUrl } from "@/lib/content/asset-url";
import {
  contentLibraryAssets,
  ASSET_TYPES,
  ASSET_CATEGORIES,
} from "@/db/schema";

export const dynamic = "force-dynamic";

const CreateBody = z.object({
  title: z.string().min(2).max(200),
  description: z.string().max(2000).optional(),
  type: z.enum(ASSET_TYPES),
  category: z.enum(ASSET_CATEGORIES).default("general"),
  fileUrl: z.string().url(),
  fileName: z.string().max(300).optional(),
  fileSizeBytes: z.number().int().nonnegative().optional(),
  mimeType: z.string().max(120).optional(),
  width: z.number().int().nonnegative().optional(),
  height: z.number().int().nonnegative().optional(),
  thumbnailUrl: z.string().url().optional(),
  tags: z.array(z.string().max(50)).optional(),
  brandingConfig: z
    .object({
      position: z.enum(["top", "bottom", "both"]).optional(),
      heightPct: z.number().min(5).max(50).optional(),
      background: z.string().optional(),
    })
    .optional(),
  publishAt: z.string().optional(),
  expireAt: z.string().optional(),
});

export async function GET() {
  try {
    const session = await requireSession();
    const platformAdmin = isPlatformAdmin(session.roles);
    if (!platformAdmin && !can(session.roles, "content_library.view", session.permissions)) {
      return NextResponse.json({ error: "forbidden — insufficient capabilities" }, { status: 403 });
    }
    // Platform admins see all assets; normal users see global assets + their tenant assets.
    // Query uses withTenant for normal users to automatically trigger Postgres RLS.
    const rows = platformAdmin
      ? await withPlatformAdmin(session.userId, async (tx) =>
          tx.select().from(contentLibraryAssets).orderBy(desc(contentLibraryAssets.createdAt))
        )
      : await withTenant(session.tenantId, async (tx) =>
          // Explicit visibility predicate — the table has no single-tenant RLS
          // policy, so without this a non-admin would see EVERY tenant's assets.
          tx
            .select()
            .from(contentLibraryAssets)
            .where(assetVisibleTo(session.tenantId))
            .orderBy(desc(contentLibraryAssets.createdAt))
        );
    const now = new Date();
    const visible = platformAdmin
      ? rows
      : rows.filter(
          (r) =>
            r.isActive &&
            (!r.publishAt || new Date(r.publishAt) <= now) &&
            (!r.expireAt || new Date(r.expireAt) > now)
        );
    // For non-admins, scrub the raw S3 URLs out of image assets — MFDs
    // can only access images via /api/content-library/[id]/branded.
    const safe = platformAdmin
      ? visible
      : visible.map((r) => {
          if (r.type !== "image") return r;
          return {
            ...r,
            fileUrl: `/api/content-library/${r.id}/branded?mode=download`,
            thumbnailUrl: `/api/content-library/${r.id}/branded?mode=preview`,
          };
        });
    return NextResponse.json({ assets: safe });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const platformAdmin = isPlatformAdmin(session.roles);
    const canUpload = platformAdmin || can(session.roles, "content_library.add", session.permissions);
    if (!canUpload) {
      return NextResponse.json({ error: "forbidden — insufficient capabilities" }, { status: 403 });
    }
    const parse = CreateBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json(
        { error: "invalid body", issues: parse.error.issues },
        { status: 400 }
      );
    }
    const body = parse.data;

    // Reject internal/non-http asset URLs at write time — the stored fileUrl is
    // later fetched server-side (branded / batch-download), so a `http://169.254…`
    // URL here would be an SSRF primitive.
    for (const u of [body.fileUrl, body.thumbnailUrl].filter(Boolean) as string[]) {
      const unsafe = isUnsafeAssetUrl(u);
      if (unsafe) return NextResponse.json({ error: `Unsafe asset URL (${unsafe})` }, { status: 400 });
    }

    const id = uuid();

    if (platformAdmin) {
      await withPlatformAdmin(session.userId, async (tx) => {
        await tx.insert(contentLibraryAssets).values({
          id,
          title: body.title,
          description: body.description ?? null,
          type: body.type,
          category: body.category,
          fileUrl: body.fileUrl,
          fileName: body.fileName ?? null,
          fileSizeBytes: body.fileSizeBytes ?? null,
          mimeType: body.mimeType ?? null,
          width: body.width ?? null,
          height: body.height ?? null,
          source: "platform",
          thumbnailUrl: body.thumbnailUrl ?? body.fileUrl,
          tags: body.tags ?? [],
          brandingConfig: body.brandingConfig ?? null,
          publishAt: body.publishAt ? new Date(body.publishAt) : null,
          expireAt: body.expireAt ? new Date(body.expireAt) : null,
          uploadedByUserId: session.userId,
          tenantId: null,
          isActive: true,
        } as any);
      });
    } else {
      await withTenant(session.tenantId, async (tx) => {
        await tx.insert(contentLibraryAssets).values({
          id,
          title: body.title,
          description: body.description ?? null,
          type: body.type,
          category: body.category,
          fileUrl: body.fileUrl,
          fileName: body.fileName ?? null,
          fileSizeBytes: body.fileSizeBytes ?? null,
          mimeType: body.mimeType ?? null,
          width: body.width ?? null,
          height: body.height ?? null,
          source: "tenant",
          thumbnailUrl: body.thumbnailUrl ?? body.fileUrl,
          tags: body.tags ?? [],
          brandingConfig: body.brandingConfig ?? null,
          publishAt: body.publishAt ? new Date(body.publishAt) : null,
          expireAt: body.expireAt ? new Date(body.expireAt) : null,
          uploadedByUserId: session.userId,
          tenantId: session.tenantId,
          isActive: true,
        } as any);
      });
    }
    return NextResponse.json({ id }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
