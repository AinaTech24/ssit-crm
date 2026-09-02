import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/families/[id]/statement/pdf
 *   Consolidated household statement — sums every family member's LIVE
 *   valuation (valueInvestor + AMFI NAV) into one combined PDF. ?download=1
 *   forces a save dialog. Reuses the single-client statement renderer with an
 *   aggregated valuation so households get one clean view.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny, can } from "@/lib/auth/rbac";
import { investors, families, tenants } from "@/db/schema";
import { valueInvestor, type InvestorValuation } from "@/lib/finance/valuation";
import { renderValuationStatementPdf } from "@/lib/finance/valuation-pdf";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["family.view", "investor.view.all", "investor.view.assigned"], session.permissions);
    const canViewAll = can(session.roles, "investor.view.all", session.permissions);
    const { id } = await params;
    const download = req.nextUrl.searchParams.get("download") === "1";

    const built = await withTenant(session.tenantId, async (tx) => {
      const [fam] = await tx
        .select({ familyName: families.familyName, headName: families.headName, rmId: families.rmId })
        .from(families)
        .where(and(eq(families.id, id), eq(families.tenantId, session.tenantId)))
        .limit(1);
      if (!fam) return null;
      // Owner scope: a household's consolidated statement (every member's name +
      // live valuation) is only pullable by a manager or the family's own RM.
      if (!canViewAll && fam.rmId !== session.userId) return null;
      const members = await tx
        .select({ id: investors.id })
        .from(investors)
        .where(and(eq(investors.familyId, id), eq(investors.tenantId, session.tenantId)));

      // Aggregate each member's live valuation into one household valuation.
      const agg: InvestorValuation = {
        currentValue: 0, investedNet: 0, pricedInvested: 0, unpricedInvested: 0,
        gain: 0, absoluteReturn: null, xirr: null, asOf: null, holdings: [], unpricedSchemes: 0,
      };
      for (const m of members) {
        const v = await valueInvestor(tx, m.id);
        agg.currentValue += v.currentValue;
        agg.investedNet += v.investedNet;
        agg.pricedInvested += v.pricedInvested;
        agg.unpricedInvested += v.unpricedInvested;
        agg.gain += v.gain;
        agg.unpricedSchemes += v.unpricedSchemes;
        agg.holdings.push(...v.holdings);
        if (v.asOf && (!agg.asOf || v.asOf > agg.asOf)) agg.asOf = v.asOf;
      }
      agg.absoluteReturn = agg.pricedInvested > 0 ? agg.gain / agg.pricedInvested : null;
      agg.holdings.sort((a, b) => (b.currentValue ?? 0) - (a.currentValue ?? 0));

      const [t] = await tx.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);
      const famName = fam.familyName ?? `${fam.headName} Family`;
      const pdf = await renderValuationStatementPdf({
        valuation: agg,
        refId: id,
        investor: { name: `${famName} (Household)`, pan: null },
        brand: {
          displayName: (t as any)?.displayName, legalName: (t as any)?.legalName, arn: (t as any)?.arn, euin: (t as any)?.euin,
          primaryColor: (t as any)?.primaryColor, secondaryColor: (t as any)?.secondaryColor, logoUrl: (t as any)?.logoUrl,
          gstNumber: (t as any)?.gstNumber, phone: (t as any)?.phone, email: (t as any)?.email, website: (t as any)?.website,
        },
        generatedAt: new Date().toISOString(),
      });
      return { pdf, name: famName, members: members.length };
    });

    if (!built) return NextResponse.json({ error: "not found" }, { status: 404 });
    const safe = built.name.replace(/[^a-z0-9]+/gi, "_").slice(0, 40);
    return new NextResponse(built.pdf as any, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `${download ? "attachment" : "inline"}; filename="FamilyStatement_${safe}_${new Date().toISOString().slice(0, 10)}.pdf"`,
        "cache-control": "no-store",
      },
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
