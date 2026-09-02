/**
 * Portfolio Review worksheet — Network FP "3.4 Portfolio Review" parity.
 *
 * Bound to a specific review meeting. Lists every folio of the
 * investor with editable per-row fields the RM fills during the
 * meeting:
 *   Fund Name / Folio · Category · Investment Type · Current Value ·
 *   Amount Invested · Start Date · Holding Period · Return % ·
 *   Exit Load · Tax Implication · Past Performance · Suitability ·
 *   Recommended Action · Remarks.
 *
 * Snapshot semantics: when the RM hits Save, the displayed numeric
 * values are persisted so a later view of the meeting shows what was
 * decided at the time, not the moved-on numbers.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny, can } from "@/lib/auth/rbac";
import {
  reviewMeetings,
  folios,
  investors,
  portfolioReviewItems,
} from "@/db/schema";
import { PortfolioReviewWorksheet } from "@/components/review-meetings/PortfolioReviewWorksheet";

export const dynamic = "force-dynamic";

export default async function MeetingPortfolioPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  requireAny(session.roles, ["review_meeting.manage.all", "review_meeting.manage.assigned"], session.permissions);
  const canAll = can(session.roles, "review_meeting.manage.all", session.permissions);
  const { id } = await params;

  const data = await withTenant(session.tenantId, async (tx) => {
    const [meeting] = await tx
      .select()
      .from(reviewMeetings)
      .where(
        and(
          eq(reviewMeetings.id, id),
          eq(reviewMeetings.tenantId, session.tenantId)
        )
      )
      .limit(1);
    if (!meeting) return null;
    // manage.assigned RMs may only open their OWN meeting's worksheet.
    if (!canAll && meeting.rmId !== session.userId) return null;

    const [investor] = meeting.investorId
      ? await tx
          .select()
          .from(investors)
          .where(
            and(
              eq(investors.id, meeting.investorId),
              eq(investors.tenantId, session.tenantId)
            )
          )
          .limit(1)
      : [null];

    const investorFolios = meeting.investorId
      ? await tx
          .select()
          .from(folios)
          .where(
            and(
              eq(folios.tenantId, session.tenantId),
              eq(folios.investorId, meeting.investorId)
            )
          )
      : [];

    const items = await tx
      .select()
      .from(portfolioReviewItems)
      .where(
        and(
          eq(portfolioReviewItems.meetingId, id),
          eq(portfolioReviewItems.tenantId, session.tenantId)
        )
      );

    return { meeting, investor, folios: investorFolios, items };
  });
  if (!data) notFound();

  // Serialise dates + numerics
  const folioRows = data.folios.map((f) => ({
    id: f.id,
    folioNumber: f.folioNumber,
    amcName: f.amcName,
    amcCode: f.amcCode,
    openedAt: f.openedAt ? String(f.openedAt) : null,
    aum: f.aum != null ? Number(f.aum) : null,
    schemes: (f.schemes ?? []) as Array<{
      schemeCode?: string;
      schemeName?: string;
      category?: string;
      units?: number;
      nav?: number;
      value?: number;
    }>,
  }));

  const itemRows = data.items.map((i) => ({
    id: i.id,
    folioId: i.folioId,
    schemeName: i.schemeName,
    fundCategory: i.fundCategory,
    investmentType: (i.investmentType ?? null) as
      | "sip"
      | "lumpsum"
      | "mixed"
      | null,
    snapshotCurrentValue:
      i.snapshotCurrentValue != null ? Number(i.snapshotCurrentValue) : null,
    snapshotInvestedAmount:
      i.snapshotInvestedAmount != null
        ? Number(i.snapshotInvestedAmount)
        : null,
    startDate: i.startDate ? String(i.startDate) : null,
    holdingPeriodMonths: i.holdingPeriodMonths ?? null,
    returnPct: i.returnPct != null ? Number(i.returnPct) : null,
    exitLoadNote: i.exitLoadNote,
    taxImplicationNote: i.taxImplicationNote,
    pastPerformanceNote: i.pastPerformanceNote,
    suitabilityNote: i.suitabilityNote,
    recommendedAction:
      (i.recommendedAction ?? "hold") as
        | "hold"
        | "no_action"
        | "switch"
        | "exit"
        | "increase"
        | "decrease"
        | "pause_sip"
        | "resume_sip"
        | "new_sip"
        | "step_up"
        | "step_down",
    rationale: i.rationale,
    remarks: i.remarks,
  }));

  return (
    <div className="space-y-5 max-w-7xl print:max-w-none">
      <div className="flex items-center justify-between print:hidden">
        <Link
          href={`/dashboard/review-meetings/${id}`}
          className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1"
        >
          <ChevronLeft className="size-3" /> Back to meeting
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-semibold">Portfolio review</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {data.investor?.name && (
            <>
              Client: <span className="font-medium">{data.investor.name}</span>{" "}
              ·{" "}
            </>
          )}
          Review date:{" "}
          {new Date(data.meeting.meetingDate).toLocaleDateString("en-GB", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          })}{" "}
          · {folioRows.length} folio{folioRows.length === 1 ? "" : "s"}
        </p>
      </div>

      <PortfolioReviewWorksheet
        meetingId={id}
        meetingDate={data.meeting.meetingDate.toISOString()}
        folios={folioRows}
        initialItems={itemRows}
      />
    </div>
  );
}
