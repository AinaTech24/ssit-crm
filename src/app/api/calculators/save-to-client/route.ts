/**
 * POST /api/calculators/save-to-client
 *
 * Render a branded calculator illustration PDF (exactly like the share route)
 * and store it in a client's document file instead of only downloading it.
 *
 * Body: { investorId, calcName, inputs?, blocks }
 *   → renders the PDF, puts the bytes in the document vault, and inserts a
 *     `compliance_documents` row linked to the investor (relatedEntityType
 *     'investor', relatedEntityId=investorId) so it surfaces in that client's
 *     Documents section.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { v4 as uuid } from "uuid";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { assertActiveLicense } from "@/lib/auth/license";
import { tenants, investors, complianceDocuments } from "@/db/schema";
import { renderCalcPdf, type PdfBlock } from "@/lib/calculators/calc-pdf";
import { fetchBrandLogoBytes } from "@/lib/calculators/share-helpers";
import { pickLogo } from "@/lib/branding/logo";
import { putObject, vaultKey, isS3Configured } from "@/lib/storage/s3";
import { firmFolderName } from "@/lib/storage/firm-folder";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  investorId: z.string().uuid(),
  calcName: z.string().min(1).max(120),
  inputs: z
    .array(z.object({ label: z.string(), value: z.string(), group: z.string().optional() }))
    .max(200)
    .optional(),
  blocks: z.array(z.any()).max(400),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await assertActiveLicense(session.tenantId, session.roles);

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    const { investorId, calcName, inputs, blocks } = parsed.data;

    const ctx = await withTenant(session.tenantId, async (tx) => {
      const tenant = (await tx.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1))[0] ?? null;
      const investor =
        (
          await tx
            .select({ id: investors.id, name: investors.name, email: investors.email, phone: investors.phone })
            .from(investors)
            .where(and(eq(investors.id, investorId), eq(investors.tenantId, session.tenantId)))
            .limit(1)
        )[0] ?? null;
      return { tenant, investor };
    });

    const tenant = ctx.tenant as any;
    if (!ctx.investor) return NextResponse.json({ error: "Client not found" }, { status: 404 });
    const investor = ctx.investor;

    const proto = req.headers.get("x-forwarded-proto") ?? "https";
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
    const origin = host ? `${proto}://${host}` : null;
    const logoBytes = await fetchBrandLogoBytes(pickLogo(tenant, "full"), origin);
    const generatedAt = new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

    const pdf = await renderCalcPdf({
      firmName: tenant?.legalName ?? tenant?.displayName ?? "Your firm",
      arn: tenant?.arn ?? null,
      preparedBy: session.name,
      firmPhone: tenant?.phone ?? null,
      firmEmail: tenant?.email ?? null,
      firmWebsite: tenant?.website ?? null,
      clientName: investor.name ?? null,
      clientEmail: investor.email ?? null,
      clientMobile: investor.phone ?? null,
      calcName,
      inputs: inputs ?? [],
      blocks: blocks as PdfBlock[],
      logoBytes,
      primaryHex: tenant?.primaryColor ?? null,
      generatedAt,
    });

    const date = new Date().toISOString().slice(0, 10);
    const filename = `${calcName}-${date}`.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 80) + ".pdf";

    // Store the bytes via the same low-level helper the compliance upload route
    // ultimately calls (server-side PUT → S3, or local-disk fallback).
    const firm = await firmFolderName(session.tenantId);
    const key = vaultKey(session.tenantId, "general", filename, {
      firm,
      uploader: session.name,
      client: investor.name,
      docType: "calculator",
    });
    try {
      await putObject(key, pdf, "application/pdf");
    } catch (e: any) {
      const detail = e?.name || e?.Code || e?.message || "unknown error";
      return NextResponse.json(
        {
          error: isS3Configured()
            ? `Storage upload failed (${detail}). Check S3 bucket/region and IAM s3:PutObject permission.`
            : `Local storage write failed (${detail}).`,
        },
        { status: 502 }
      );
    }

    const documentId = uuid();
    const meta = clientMetaFromHeaders(req.headers);
    await withTenant(session.tenantId, async (tx) => {
      await tx.insert(complianceDocuments).values({
        id: documentId,
        tenantId: session.tenantId,
        category: "other",
        name: `${calcName} illustration`,
        storageKey: key,
        mimeType: "application/pdf",
        sizeBytes: String(pdf.length),
        relatedEntityType: "investor",
        relatedEntityId: investorId,
        tags: ["client", "calculator"],
        uploadedByUserId: session.userId,
      } as any);

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "calculator.save_to_client",
        entityType: "investor",
        entityId: investorId,
        after: { calcName, documentId, name: `${calcName} illustration` } as any,
        ...meta,
      });
    });

    return NextResponse.json({ ok: true, documentId });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Could not save" }, { status: err?.status ?? 500 });
  }
}
