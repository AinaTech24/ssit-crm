import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /portfolio/<token>/pdf — public, login-free portfolio STATEMENT PDF.
 *
 * Same document the RM gets from "Download statement" (live valuation engine +
 * AMFI NAV + branded valuation-statement renderer), but served against a
 * portfolio_view share token so it can be shared with the client over WhatsApp
 * without a login. The "Share live portfolio" action links here.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { withSystem } from "@/db/client";
import { investors, tenants } from "@/db/schema";
import { resolveShareToken } from "@/lib/share-tokens";
import { valueInvestor } from "@/lib/finance/valuation";
import { renderValuationStatementPdf } from "@/lib/finance/valuation-pdf";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;

    // Anonymous shareable link — cap abuse / scraping by IP.
    const h = await headers();
    const ip = (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "anon").trim();
    const rl = checkRateLimit("public.portfolio.pdf", ip, { limit: 30, windowSec: 60 });
    if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

    let info: Awaited<ReturnType<typeof resolveShareToken>>;
    try {
      info = await resolveShareToken(token);
    } catch (e: any) {
      return NextResponse.json({ error: e?.message ?? "This link is no longer valid" }, { status: 410 });
    }
    if (info.kind !== "portfolio_view" || info.subjectType !== "investor") {
      return NextResponse.json({ error: "This link is not a portfolio statement." }, { status: 400 });
    }

    const built = await withSystem(async (tx) => {
      const [inv] = await tx
        .select({ id: investors.id, name: investors.name, pan: investors.pan })
        .from(investors)
        .where(eq(investors.id, info.subjectId))
        .limit(1);
      if (!inv) return null;
      const valuation = await valueInvestor(tx, info.subjectId);
      const [t] = await tx.select().from(tenants).where(eq(tenants.id, info.tenantId)).limit(1);
      const pdf = await renderValuationStatementPdf({
        valuation,
        investor: { name: inv.name, pan: inv.pan },
        brand: {
          displayName: (t as any)?.displayName,
          legalName: (t as any)?.legalName,
          arn: (t as any)?.arn,
          primaryColor: (t as any)?.primaryColor,
          secondaryColor: (t as any)?.secondaryColor,
          logoUrl: (t as any)?.logoUrl,
          gstNumber: (t as any)?.gstNumber,
          phone: (t as any)?.phone,
          email: (t as any)?.email,
          website: (t as any)?.website,
        },
        generatedAt: new Date().toISOString(),
      });
      return { pdf, name: inv.name ?? "client" };
    });

    if (!built) return NextResponse.json({ error: "Portfolio not found." }, { status: 404 });

    const safe = built.name.replace(/[^a-z0-9]+/gi, "_").slice(0, 40);
    return new NextResponse(built.pdf as any, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${safe}_portfolio_statement.pdf"`,
        "cache-control": "no-store",
      },
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
