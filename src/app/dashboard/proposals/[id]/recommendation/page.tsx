/**
 * Product Recommendation worksheet — Network FP "3.6 Product
 * Recommendation" parity.
 *
 * 4 sections: SIP / Lumpsum / SWP / STP. Each renders one editable
 * table that maps to proposal_schemes rows tagged with the matching
 * recommendation_type.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import {
  proposals,
  proposalSchemes,
  investors,
} from "@/db/schema";
import { RecommendationWorksheet } from "@/components/proposals/RecommendationWorksheetLazy";

export const dynamic = "force-dynamic";

export default async function RecommendationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;

  const data = await withTenant(session.tenantId, async (tx) => {
    const [proposal] = await tx
      .select()
      .from(proposals)
      .where(
        and(
          eq(proposals.id, id),
          eq(proposals.tenantId, session.tenantId)
        )
      )
      .limit(1);
    if (!proposal) return null;

    const rows = await tx
      .select()
      .from(proposalSchemes)
      .where(eq(proposalSchemes.proposalId, id));

    const investor = proposal.investorId
      ? (
          await tx
            .select()
            .from(investors)
            .where(eq(investors.id, proposal.investorId))
            .limit(1)
        )[0] ?? null
      : null;

    return { proposal, rows, investor };
  });
  if (!data) notFound();

  // Serialise numerics + dates for the client
  const rows = data.rows.map((r) => ({
    id: r.id,
    amc: r.amc,
    schemeName: r.schemeName,
    schemeCode: r.schemeCode,
    schemeCategory: r.schemeCategory,
    assetClass: r.assetClass,
    schemeRiskLevel: r.schemeRiskLevel,
    recommendationType:
      (r.recommendationType ?? "sip") as "sip" | "lumpsum" | "swp" | "stp",
    planType: (r.planType ?? null) as "regular" | "direct" | null,
    sipAmount: r.sipAmount != null ? Number(r.sipAmount) : null,
    lumpsumAmount: r.lumpsumAmount != null ? Number(r.lumpsumAmount) : null,
    expectedReturnPct:
      r.expectedReturnPct != null ? Number(r.expectedReturnPct) : null,
    expectedHoldingYears: r.expectedHoldingYears ?? null,
    stepUpPct: r.stepUpPct != null ? Number(r.stepUpPct) : null,
    goalOrObjective: r.goalOrObjective,
    corpusRequired:
      r.corpusRequired != null ? Number(r.corpusRequired) : null,
    monthlyWithdrawal:
      r.monthlyWithdrawal != null ? Number(r.monthlyWithdrawal) : null,
    swpPeriodMonths: r.swpPeriodMonths ?? null,
    toSchemeName: r.toSchemeName,
    toSchemeCode: r.toSchemeCode,
    monthlyTransfer:
      r.monthlyTransfer != null ? Number(r.monthlyTransfer) : null,
    numInstallments: r.numInstallments ?? null,
    totalCorpusForStp:
      r.totalCorpusForStp != null ? Number(r.totalCorpusForStp) : null,
  }));

  return (
    <div className="space-y-5 max-w-7xl print:max-w-none">
      <div className="flex items-center justify-between print:hidden">
        <Link
          href={`/dashboard/proposals/${id}`}
          className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1"
        >
          <ChevronLeft className="size-3" /> Back to proposal
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-semibold">Product recommendation</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {data.investor?.name && (
            <>
              Client:{" "}
              <span className="font-medium">{data.investor.name}</span> ·{" "}
            </>
          )}
          {data.investor?.riskProfile && (
            <>Risk profile: {data.investor.riskProfile} · </>
          )}
          Recommendation date:{" "}
          {new Date().toLocaleDateString("en-GB", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          })}
        </p>
      </div>

      <RecommendationWorksheet proposalId={id} initialRows={rows} />
    </div>
  );
}
