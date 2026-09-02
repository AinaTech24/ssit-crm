import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/content-library/[id]/branded?mode=preview|download
 *
 * Returns the asset's image with the caller's tenant branding strip
 * composited server-side. The raw S3 file URL is NEVER returned to the
 * MFD's browser — this endpoint is the only access path.
 *
 *   mode=preview   → inline (used by the <img> preview on the detail page)
 *   mode=download  → Content-Disposition: attachment (for the Download button)
 *
 * Cache: per-tenant, immutable for 5 minutes (the asset itself never
 * changes; the branding is derived from the caller's session). The cache
 * key embeds tenantId so two tenants can't share a cached payload.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withSystem, withTenant } from "@/db/client";
import { contentLibraryAssets, tenants } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { composeBrandedImage, type BrandingTenant } from "@/lib/branding/compose";
import { getBrandingTemplate, getOutputAspect } from "@/lib/branding/templates";
import { pickLogo } from "@/lib/branding/logo";
import { assetVisibleTo, fetchAssetBytes } from "@/lib/content/asset-url";
import { recordContentEvent } from "@/lib/content/events";

export const dynamic = "force-dynamic";
// sharp needs the Node runtime, not Edge.
export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    const url = new URL(req.url);
    const mode = url.searchParams.get("mode") === "download" ? "download" : "preview";
    // Named branding preset (Classic/Minimal/Bold/Split) — maps to a
    // position + heightPct via the shared catalog. Explicit position/h params
    // (below) still win, preserving the original fine-grained controls.
    const templateParam = url.searchParams.get("template");
    // MFD-controllable layout overrides
    const posParam = url.searchParams.get("position");
    const overridePosition: "top" | "bottom" | "both" | "split" | "frame" | null =
      posParam === "top" ||
      posParam === "bottom" ||
      posParam === "both" ||
      posParam === "split" ||
      posParam === "frame"
        ? posParam
        : null;
    const heightParam = url.searchParams.get("h");
    const overrideHeight = heightParam ? Number(heightParam) : null;
    const variantParam = url.searchParams.get("variant");
    const overrideVariant: "solid" | "light" | null =
      variantParam === "solid" || variantParam === "light" ? variantParam : null;
    // Multi-size export: map the size preset to a width/height aspect.
    const outputAspect = getOutputAspect(url.searchParams.get("size"));
    const ftParam = url.searchParams.get("frametheme");
    const overrideFrameTheme: "premium" | "minimal" | "bold" | null =
      ftParam === "premium" || ftParam === "minimal" || ftParam === "bold" ? ftParam : null;

    // Load asset — global OR caller's own (withSystem bypasses RLS, so this
    // predicate is what stops cross-tenant image exfiltration by id).
    const asset = await withSystem(async (tx) =>
      (await tx
        .select()
        .from(contentLibraryAssets)
        .where(and(eq(contentLibraryAssets.id, id), assetVisibleTo(session.tenantId)))
        .limit(1))[0] ?? null
    );
    if (!asset) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (!asset.isActive) return NextResponse.json({ error: "asset inactive" }, { status: 410 });
    if (asset.type !== "image") {
      return NextResponse.json(
        { error: `branded rendering is only supported for image assets (this one is ${asset.type})` },
        { status: 400 }
      );
    }

    const tenant = (await withTenant(session.tenantId, async (tx) =>
      tx.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1)
    ))[0];
    if (!tenant) return NextResponse.json({ error: "tenant not found" }, { status: 404 });

    // Fetch the source bytes — server-to-server, never exposed to the browser.
    // SSRF-guarded + timed + size-capped (the fileUrl can be tenant-controlled).
    const fetched = await fetchAssetBytes(asset.fileUrl);
    if (!fetched.ok) {
      return NextResponse.json({ error: fetched.error }, { status: fetched.status });
    }
    const sourceBuf = fetched.buf;

    // Build the branding snapshot
    const brand: BrandingTenant = {
      displayName: tenant.displayName ?? null,
      legalName: tenant.legalName ?? null,
      arn: tenant.arn ?? null,
      phone: (tenant as any).phone ?? null,
      email: (tenant as any).email ?? null,
      website: (tenant as any).website ?? null,
      address: (tenant as any).address ?? null,
      // Use the same fallback chain as the sidebar (full → icon → mark) so a
      // firm that uploaded only a square icon / monogram — not the full-logo
      // slot — still gets their real logo on the creative instead of an initial.
      logoUrl: pickLogo(tenant as any, "full"),
      primaryColor: (tenant as any).primaryColor ?? null,
    };

    // Per-request overrides take precedence over the asset's defaults.
    const config = { ...((asset.brandingConfig as any) ?? {}) };
    // Apply the named template first (if supplied), then let any explicit
    // position/height params override it.
    if (templateParam) {
      const t = getBrandingTemplate(templateParam);
      config.position = t.image.position;
      config.heightPct = t.image.heightPct;
      config.variant = t.image.variant ?? "solid";
      if (t.image.frameTheme) config.frameTheme = t.image.frameTheme;
    }
    if (overridePosition) config.position = overridePosition;
    if (overrideHeight && overrideHeight >= 5 && overrideHeight <= 50) {
      config.heightPct = overrideHeight;
    }
    if (overrideVariant) config.variant = overrideVariant;
    if (overrideFrameTheme) config.frameTheme = overrideFrameTheme;
    config.outputAspect = outputAspect;

    const pngBuf = await composeBrandedImage(sourceBuf, brand, config);

    // Usage analytics — a preview render means the MFD co-branded it; a download
    // means they saved it. Best-effort, never blocks the response.
    void recordContentEvent({
      assetId: id,
      tenantId: session.tenantId,
      userId: session.userId,
      eventType: mode === "download" ? "download" : "cobrand",
    });

    const filename = `${(asset.title ?? "asset").replace(/[^a-zA-Z0-9._-]/g, "_")}-${
      (tenant.arn ?? "").replace(/^ARN-?/i, "")
    }.png`;

    // Tight per-tenant cache. The S3 ETag isn't checked here — invalidate
    // by re-uploading or PATCHing the asset (createdAt changes don't affect
    // the rendered output).
    const headers = new Headers({
      "Content-Type": "image/png",
      // The preview must reflect branding/profile edits immediately, so it's
      // never cached — otherwise saving a logo/contact still shows the stale
      // composite. The download link can cache briefly (same render, fetched once).
      "Cache-Control": mode === "download" ? "private, max-age=300" : "no-store, must-revalidate",
      "Content-Disposition":
        mode === "download" ? `attachment; filename="${filename}"` : `inline; filename="${filename}"`,
    });
    return new NextResponse(new Uint8Array(pngBuf), { status: 200, headers });
  } catch (err: any) {
    return handleApiError(err);
  }
}
