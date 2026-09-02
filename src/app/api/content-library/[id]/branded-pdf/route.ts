import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/content-library/[id]/branded-pdf?mode=preview|download&template=classic
 *
 * Returns the PDF asset white-labelled for the calling MFD: a branded cover
 * page (logo / firm name / ARN / title) prepended, plus a firm·ARN·SEBI
 * disclaimer·page-no footer band stamped on every page.
 *
 *   mode=preview   → inline (used by the iframe preview on the detail page)
 *   mode=download  → Content-Disposition: attachment
 *   template=…     → one of the named branding presets (Classic/Minimal/Bold/Split)
 *
 * The raw S3 URL is NEVER returned to the browser — this endpoint is the only
 * access path for a co-branded PDF. The source bytes are pulled server-to-
 * server through the SSRF-guarded fetchAssetBytes().
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withSystem, withTenant } from "@/db/client";
import { contentLibraryAssets, tenants } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { assetVisibleTo, fetchAssetBytes } from "@/lib/content/asset-url";
import { composeBrandedPdf } from "@/lib/branding/compose-pdf";
import { getBrandingTemplate } from "@/lib/branding/templates";
import type { BrandingTenant } from "@/lib/branding/compose";

export const dynamic = "force-dynamic";
// pdf-lib needs the Node runtime, not Edge.
export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    const url = new URL(req.url);
    const mode = url.searchParams.get("mode") === "download" ? "download" : "preview";
    const template = getBrandingTemplate(url.searchParams.get("template"));

    // Load asset — global OR caller's own. withSystem bypasses RLS, so this
    // explicit predicate is what stops cross-tenant PDF exfiltration by id.
    const asset = await withSystem(async (tx) =>
      (await tx
        .select()
        .from(contentLibraryAssets)
        .where(and(eq(contentLibraryAssets.id, id), assetVisibleTo(session.tenantId)))
        .limit(1))[0] ?? null
    );
    if (!asset) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (!asset.isActive) return NextResponse.json({ error: "asset inactive" }, { status: 410 });
    if (asset.type !== "pdf") {
      return NextResponse.json(
        { error: `co-branded PDF is only supported for PDF assets (this one is ${asset.type})` },
        { status: 400 }
      );
    }

    const tenant = (await withTenant(session.tenantId, async (tx) =>
      tx.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1)
    ))[0];
    if (!tenant) return NextResponse.json({ error: "tenant not found" }, { status: 404 });

    // Fetch the source PDF bytes — SSRF-guarded + timed + size-capped (fileUrl
    // is operator-controlled but still treated as untrusted).
    const fetched = await fetchAssetBytes(asset.fileUrl);
    if (!fetched.ok) {
      return NextResponse.json({ error: fetched.error }, { status: fetched.status });
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
      secondaryColor: (tenant as any).secondaryColor ?? null,
    };

    // Best-effort logo fetch (same SSRF guard). A failure just falls back to a
    // coloured initial tile inside the compositor.
    let logoBytes: Buffer | null = null;
    if (brand.logoUrl) {
      const logo = await fetchAssetBytes(brand.logoUrl);
      if (logo.ok) logoBytes = logo.buf;
    }

    let pdfBuf: Buffer;
    try {
      pdfBuf = await composeBrandedPdf(fetched.buf, brand, template, {
        title: asset.title,
        category: asset.category,
        logoBytes,
      });
    } catch (e: any) {
      // A malformed / unsupported source PDF shouldn't 500 the route — report
      // a clean 422 so the UI can fall back to "Download original".
      return NextResponse.json(
        { error: `could not co-brand this PDF (${e?.message ?? "invalid PDF"})` },
        { status: 422 }
      );
    }

    const filename = `${(asset.title ?? "asset").replace(/[^a-zA-Z0-9._-]/g, "_")}-${
      (tenant.arn ?? "").replace(/^ARN-?/i, "")
    }.pdf`;

    const headers = new Headers({
      "Content-Type": "application/pdf",
      "Cache-Control": "private, max-age=300",
      "Content-Disposition":
        mode === "download" ? `attachment; filename="${filename}"` : `inline; filename="${filename}"`,
    });
    return new NextResponse(new Uint8Array(pdfBuf), { status: 200, headers });
  } catch (err: any) {
    return handleApiError(err);
  }
}
