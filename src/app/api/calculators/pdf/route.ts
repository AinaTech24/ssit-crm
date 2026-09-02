/**
 * POST /api/calculators/pdf
 *
 * Build a branded, firm-letterhead PDF from a captured calculator result
 * (title + blocks) and return it as a download. Body:
 *   { calcName, clientName?, blocks: PdfBlock[] }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { tenants } from "@/db/schema";
import { renderCalcPdf, type PdfBlock } from "@/lib/calculators/calc-pdf";
import { fetchBrandLogoBytes } from "@/lib/calculators/share-helpers";
import { pickLogo } from "@/lib/branding/logo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  calcName: z.string().min(1).max(120),
  clientName: z.string().max(120).optional().nullable(),
  clientEmail: z.string().max(160).optional().nullable(),
  clientMobile: z.string().max(40).optional().nullable(),
  inputs: z.array(z.object({ label: z.string(), value: z.string(), group: z.string().optional() })).max(200).optional(),
  blocks: z.array(z.any()).max(400),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    const { calcName, clientName, clientEmail, clientMobile, inputs, blocks } = parsed.data;

    const tenant = await withTenant(session.tenantId, async (tx) =>
      (await tx.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1))[0] ?? null
    );

    const proto = req.headers.get("x-forwarded-proto") ?? "https";
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
    const origin = host ? `${proto}://${host}` : null;
    const logoBytes = await fetchBrandLogoBytes(pickLogo(tenant as any, "full"), origin);
    const generatedAt = new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
    const pdf = await renderCalcPdf({
      firmName: tenant?.legalName ?? tenant?.displayName ?? "Your firm",
      arn: tenant?.arn ?? null,
      preparedBy: session.name,
      firmPhone: tenant?.phone ?? null,
      firmEmail: tenant?.email ?? null,
      firmWebsite: tenant?.website ?? null,
      clientName: clientName ?? null,
      clientEmail: clientEmail ?? null,
      clientMobile: clientMobile ?? null,
      calcName,
      inputs: inputs ?? [],
      blocks: blocks as PdfBlock[],
      logoBytes,
      primaryHex: (tenant as any)?.primaryColor ?? null,
      generatedAt,
    });

    const fname = `${clientName || "Client"}-${calcName}`.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 60) + ".pdf";
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fname}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Could not build PDF" }, { status: err?.status ?? 500 });
  }
}
