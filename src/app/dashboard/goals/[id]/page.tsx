/**
 * Per-goal detail — calculator-first.
 *
 * Server-loads the goal + investor + investor's portfolio (folios + active SIPs).
 * Renders:
 *   - Header card with goal + investor identity
 *   - Action row (Print summary · Print detailed · WhatsApp link · Email link)
 *   - <GoalDetailCalculator> (editable assumptions + live results)
 *   - <LinkedInvestmentsPicker> (folios + SIPs the RM picks to count toward this goal)
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { ChevronLeft, Target, Printer, FileText } from "lucide-react";
import { withTenant } from "@/db/client";
import { goals, investors, folios, sips } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { categoryLabel } from "@/lib/goal-planning/calc";
import { GoalDetailCalculator } from "@/components/goal-planning/GoalDetailCalculator";
import { LinkedInvestmentsPicker } from "@/components/goal-planning/LinkedInvestmentsPicker";
import { GoalShareActions } from "@/components/goal-planning/GoalShareActions";
import { RecomputeGoalButton } from "@/components/goal-planning/RecomputeGoalButton";
import { RecordProvenance } from "@/components/common/RecordProvenance";

export const dynamic = "force-dynamic";

export default async function GoalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const data = await withTenant(session.tenantId, async (tx) => {
    const g = (await tx.select().from(goals).where(eq(goals.id, id)).limit(1))[0];
    if (!g) return null;
    const inv = (await tx.select().from(investors).where(eq(investors.id, g.investorId)).limit(1))[0];

    // Investor's portfolio for the picker
    const investorFolios = await tx
      .select()
      .from(folios)
      .where(eq(folios.investorId, g.investorId))
      .orderBy(desc(folios.aum));

    const investorSips = await tx
      .select()
      .from(sips)
      .where(and(eq(sips.investorId, g.investorId), eq(sips.status, "active")))
      .orderBy(desc(sips.amount));

    return { goal: g, investor: inv, folios: investorFolios, sips: investorSips };
  });
  if (!data) notFound();

  return (
    <div className="space-y-4 max-w-7xl">
      <Link
        href="/dashboard/goals"
        className="text-sm text-muted-foreground hover:underline flex items-center gap-1"
      >
        <ChevronLeft className="size-4" /> Back to goals
      </Link>

      {/* Header */}
      <div className="card-surface p-6 flex items-start gap-4">
        <div className="size-12 rounded-lg bg-brand-cyan-light grid place-items-center">
          <Target className="size-6 text-brand-cyan" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">{data.goal.name}</h1>
          <div className="text-sm text-muted-foreground mt-1 flex items-center gap-3 flex-wrap">
            <span>{categoryLabel(data.goal.category)}</span>
            <span>·</span>
            <Link href={`/dashboard/investors/${data.goal.investorId}`} className="hover:underline">
              {data.investor?.name ?? "Investor"}
            </Link>
            {data.investor?.pan && (
              <>
                <span>·</span>
                <span className="font-mono text-xs">{data.investor.pan}</span>
              </>
            )}
          </div>
          <RecordProvenance
            entityType="goal"
            entityId={data.goal.id}
            createdAt={data.goal.createdAt}
            updatedAt={data.goal.updatedAt}
            className="mt-1"
          />
        </div>
        <div className="flex items-center gap-2">
          <RecomputeGoalButton goalId={data.goal.id} />
          <Link
            href={`/dashboard/goals/${data.goal.id}/print?view=summary`}
            target="_blank"
            className="btn-secondary text-xs"
          >
            <Printer className="size-3.5" /> Summary PDF
          </Link>
          <Link
            href={`/dashboard/goals/${data.goal.id}/print?view=detailed`}
            target="_blank"
            className="btn-primary text-xs"
          >
            <FileText className="size-3.5" /> Detailed PDF
          </Link>
        </div>
      </div>

      {/* Share strip — WhatsApp + Email */}
      <GoalShareActions
        goalId={data.goal.id}
        goalName={data.goal.name}
        investorName={data.investor?.name ?? "Investor"}
        investorPhone={data.investor?.whatsappPhone ?? data.investor?.phone ?? null}
        investorEmail={data.investor?.email ?? null}
      />

      {/* Calculator */}
      <GoalDetailCalculator goal={JSON.parse(JSON.stringify(data.goal))} />

      {/* Linked investments picker */}
      <LinkedInvestmentsPicker
        goalId={data.goal.id}
        initiallyLinkedFolioIds={(data.goal.linkedFolios as string[] | null) ?? []}
        initiallyLinkedSipIds={(data.goal.linkedSips as string[] | null) ?? []}
        initialFolioAllocations={
          (data.goal.folioAllocations as { folioId: string; allocationPct: number }[] | null) ?? []
        }
        initialSipAllocations={
          (data.goal.sipAllocations as { sipId: string; allocationPct: number }[] | null) ?? []
        }
        folios={data.folios.map((f) => ({
          id: f.id,
          folioNumber: f.folioNumber,
          amcName: f.amcName,
          aum: Number(f.aum ?? 0),
        }))}
        sips={data.sips.map((s) => ({
          id: s.id,
          schemeName: s.schemeName,
          amount: Number(s.amount ?? 0),
          status: s.status,
          frequency: s.frequency,
        }))}
      />
    </div>
  );
}
