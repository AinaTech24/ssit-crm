import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/investors/[id]/statement/pdf
 *   Server-rendered portfolio valuation statement (PDF), wired to the LIVE
 *   valuation engine (valueInvestor + AMFI NAV). Streams application/pdf.
 *   ?download=1 forces a save dialog; default is inline (browser preview).
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { investors, tenants } from "@/db/schema";
import { assertCanViewClient } from "@/lib/investors/access";
import { valueInvestor } from "@/lib/finance/valuation";
import { renderValuationStatementPdf } from "@/lib/finance/valuation-pdf";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["investor.view.all", "investor.view.assigned"], session.permissions);
    const { id } = await params;
    const download = req.nextUrl.searchParams.get("download") === "1";

    const built = await withTenant(session.tenantId, async (tx) => {
      const [inv] = await tx
        .select({
          id: investors.id, name: investors.name, pan: investors.pan,
          rmId: investors.rmId, serviceRmId: investors.serviceRmId, branchId: investors.branchId,
        })
        .from(investors)
        .where(and(eq(investors.id, id), eq(investors.tenantId, session.tenantId)))
        .limit(1);
      if (!inv) return null;
      await assertCanViewClient(tx, session, inv);
      const valuation = await valueInvestor(tx, id);
      const [t] = await tx.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);
      const pdf = await renderValuationStatementPdf({
        valuation,
        refId: id,
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

    if (!built) return NextResponse.json({ error: "not found" }, { status: 404 });

    const safe = built.name.replace(/[^a-z0-9]+/gi, "_").slice(0, 40);
    const disposition = download ? "attachment" : "inline";
    return new NextResponse(built.pdf as any, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `${disposition}; filename="Statement_${safe}_${new Date().toISOString().slice(0, 10)}.pdf"`,
        "cache-control": "no-store",
      },
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
