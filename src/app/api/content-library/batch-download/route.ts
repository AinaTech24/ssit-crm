import { handleApiError } from "@/lib/api/error-handler";
import { NextRequest, NextResponse } from "next/server";
import { and, inArray, eq } from "drizzle-orm";
import { assetVisibleTo, fetchAssetBytes } from "@/lib/content/asset-url";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { contentLibraryAssets, tenants } from "@/db/schema";
import { composeBrandedImage, type BrandingTenant } from "@/lib/branding/compose";
import { createZipArchive } from "@/lib/utils/zip";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const url = new URL(req.url);
    const idsParam = url.searchParams.get("ids") ?? "";
    const ids = idsParam.split(",").map((s) => s.trim()).filter(Boolean);

    if (ids.length === 0) {
      return NextResponse.json({ error: "no asset IDs provided" }, { status: 400 });
    }
    if (ids.length > 50) {
      return NextResponse.json({ error: "too many assets requested (max 50)" }, { status: 400 });
    }

    // 1. Fetch matching assets — global OR caller's own. The explicit predicate
    //    is required (the table has no single-tenant RLS policy).
    const assets = await withTenant(session.tenantId, async (tx) =>
      tx
        .select()
        .from(contentLibraryAssets)
        .where(and(inArray(contentLibraryAssets.id, ids), assetVisibleTo(session.tenantId)))
    );

    if (assets.length === 0) {
      return NextResponse.json({ error: "no valid assets found" }, { status: 404 });
    }

    // 2. Fetch MFD tenant details for co-branding
    const tenant = await withTenant(session.tenantId, async (tx) =>
      (await tx.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1))[0]
    );

    if (!tenant) {
      return NextResponse.json({ error: "tenant details not found" }, { status: 404 });
    }

    const brand: BrandingTenant = {
      displayName: tenant.displayName ?? null,
      legalName: tenant.legalName ?? null,
      arn: tenant.arn ?? null,
      phone: (tenant as any).phone ?? null,
      email: (tenant as any).email ?? null,
      website: (tenant as any).website ?? null,
      address: (tenant as any).address ?? null,
      logoUrl: (tenant as any).logoUrl ?? null,
      primaryColor: (tenant as any).primaryColor ?? null,
    };

    // 3. Process each asset (concurrently using Promise.all)
    const entries = await Promise.all(
      assets.map(async (asset) => {
        try {
          const fetched = await fetchAssetBytes(asset.fileUrl);
          if (!fetched.ok) {
            console.error(`Failed to fetch asset file: ${asset.fileUrl} (${fetched.error})`);
            return null;
          }
          const dataBuf = fetched.buf;

          if (asset.type === "image") {
            const config = { ...((asset.brandingConfig as any) ?? {}) };
            const brandedBuf = await composeBrandedImage(dataBuf, brand, config);
            const safeTitle = asset.title.replace(/[^a-zA-Z0-9._-]/g, "_");
            const filename = `${safeTitle}-${(tenant.arn ?? "").replace(/^ARN-?/i, "")}.png`;
            return { name: filename, data: brandedBuf };
          } else {
            const filename = asset.fileName ?? `${asset.title.replace(/[^a-zA-Z0-9._-]/g, "_")}.${asset.type === "pdf" ? "pdf" : "bin"}`;
            return { name: filename, data: dataBuf };
          }
        } catch (e) {
          console.error(`Error processing asset ${asset.id}:`, e);
          return null;
        }
      })
    );

    // Filter out failed entries
    const validEntries = entries.filter((e): e is { name: string; data: Buffer } => e !== null);

    if (validEntries.length === 0) {
      return NextResponse.json({ error: "failed to download or process any assets" }, { status: 500 });
    }

    // 4. Create ZIP archive
    const zipBuf = createZipArchive(validEntries);

    // 5. Stream ZIP back to client
    const headers = new Headers({
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="ssit-library-${Date.now()}.zip"`,
      "Cache-Control": "no-cache",
    });

    return new NextResponse(new Uint8Array(zipBuf), { status: 200, headers });
  } catch (err: any) {
    return handleApiError(err);
  }
}
