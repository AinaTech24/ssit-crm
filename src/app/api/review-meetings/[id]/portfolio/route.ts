import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/review-meetings/[id]/portfolio
 *   Loads existing portfolio_review_items for the meeting + every
 *   folio of the investor (so the RM can review folios that haven't
 *   been entered yet).
 *
 * PUT /api/review-meetings/[id]/portfolio
 *   Bulk upsert review items. The RM works through 10-20 folios at once
 *   during the meeting — chatty single-row API would be slow.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny, can } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import {
  reviewMeetings,
  folios,
  portfolioReviewItems,
} from "@/db/schema";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";

export const dynamic = "force-dynamic";

const RECOMMENDED_ACTIONS = [
  "hold",
  "no_action",
  "switch",
  "exit",
  "increase",
  "decrease",
  "pause_sip",
  "resume_sip",
  "new_sip",
  "step_up",
  "step_down",
] as const;

const ItemSchema = z.object({
  /** When omitted the row is created. When set, updated. */
  id: z.string().uuid().optional(),
  folioId: z.string().uuid(),
  schemeName: z.string().max(200).nullable().optional(),
  fundCategory: z.string().max(120).nullable().optional(),
  investmentType: z.enum(["sip", "lumpsum", "mixed"]).nullable().optional(),
  snapshotCurrentValue: z.number().nullable().optional(),
  snapshotInvestedAmount: z.number().nullable().optional(),
  snapshotUnits: z.number().nullable().optional(),
  startDate: z.string().nullable().optional(),
  holdingPeriodMonths: z.number().int().nullable().optional(),
  returnPct: z.number().nullable().optional(),
  exitLoadNote: z.string().max(1000).nullable().optional(),
  taxImplicationNote: z.string().max(1000).nullable().optional(),
  pastPerformanceNote: z.string().max(2000).nullable().optional(),
  suitabilityNote: z.string().max(2000).nullable().optional(),
  recommendedAction: z.enum(RECOMMENDED_ACTIONS).default("hold"),
  targetSchemeId: z.string().uuid().nullable().optional(),
  actionAmount: z.number().nullable().optional(),
  rationale: z.string().max(2000).nullable().optional(),
  remarks: z.string().max(2000).nullable().optional(),
});

const PutBody = z.object({
  items: z.array(ItemSchema).max(100),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    // RMs with manage.assigned may open the worksheet for THEIR OWN meetings —
    // not just back-office (.all). Ownership is enforced after the meeting loads.
    requireAny(session.roles, ["review_meeting.manage.all", "review_meeting.manage.assigned"], session.permissions);
    const canAll = can(session.roles, "review_meeting.manage.all", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const { id } = await params;

    const result = await withTenant(session.tenantId, async (tx) => {
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
      if (!canAll && meeting.rmId !== session.userId) return { forbidden: true as const };

      const items = await tx
        .select()
        .from(portfolioReviewItems)
        .where(
          and(
            eq(portfolioReviewItems.meetingId, id),
            eq(portfolioReviewItems.tenantId, session.tenantId)
          )
        );

      // Pull every active folio for this investor so the RM can add
      // items they haven't reviewed yet.
      let investorFolios: typeof folios.$inferSelect[] = [];
      if (meeting.investorId) {
        investorFolios = await tx
          .select()
          .from(folios)
          .where(
            and(
              eq(folios.tenantId, session.tenantId),
              eq(folios.investorId, meeting.investorId)
            )
          );
      }
      return { meeting, items, folios: investorFolios };
    });
    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
    if ("forbidden" in result) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["review_meeting.manage.all", "review_meeting.manage.assigned"], session.permissions);
    const canAll = can(session.roles, "review_meeting.manage.all", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const { id } = await params;
    const parse = PutBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json(
        { error: "invalid body", issues: parse.error.issues },
        { status: 400 }
      );
    }
    const meta = clientMetaFromHeaders(req.headers);

    const updated = await withTenant(session.tenantId, async (tx) => {
      // Verify meeting belongs to tenant
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
      if (!meeting) throw new Error("meeting not found");
      if (!canAll && meeting.rmId !== session.userId) {
        throw Object.assign(new Error("forbidden"), { status: 403 });
      }

      const existing = await tx
        .select()
        .from(portfolioReviewItems)
        .where(
          and(
            eq(portfolioReviewItems.meetingId, id),
            eq(portfolioReviewItems.tenantId, session.tenantId)
          )
        );
      const existingByFolio = new Map(existing.map((e) => [e.folioId, e]));

      const out: any[] = [];
      for (const item of parse.data.items) {
        const cur = existingByFolio.get(item.folioId);
        const payload: any = {
          schemeName: item.schemeName ?? null,
          fundCategory: item.fundCategory ?? null,
          investmentType: item.investmentType ?? null,
          snapshotCurrentValue:
            item.snapshotCurrentValue != null
              ? String(item.snapshotCurrentValue)
              : null,
          snapshotInvestedAmount:
            item.snapshotInvestedAmount != null
              ? String(item.snapshotInvestedAmount)
              : null,
          snapshotUnits:
            item.snapshotUnits != null ? String(item.snapshotUnits) : null,
          startDate: item.startDate ?? null,
          holdingPeriodMonths: item.holdingPeriodMonths ?? null,
          returnPct: item.returnPct != null ? String(item.returnPct) : null,
          exitLoadNote: item.exitLoadNote ?? null,
          taxImplicationNote: item.taxImplicationNote ?? null,
          pastPerformanceNote: item.pastPerformanceNote ?? null,
          suitabilityNote: item.suitabilityNote ?? null,
          recommendedAction: item.recommendedAction,
          targetSchemeId: item.targetSchemeId ?? null,
          actionAmount:
            item.actionAmount != null ? String(item.actionAmount) : null,
          rationale: item.rationale ?? null,
          remarks: item.remarks ?? null,
          updatedAt: new Date(),
        };
        if (cur) {
          const [next] = await tx
            .update(portfolioReviewItems)
            .set(payload)
            .where(
              and(
                eq(portfolioReviewItems.id, cur.id),
                eq(portfolioReviewItems.tenantId, session.tenantId)
              )
            )
            .returning();
          out.push(next);
        } else {
          const [created] = await tx
            .insert(portfolioReviewItems)
            .values({
              tenantId: session.tenantId,
              meetingId: id,
              folioId: item.folioId,
              createdBy: session.userId,
              ...payload,
            } as any)
            .returning();
          out.push(created);
        }
      }

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "portfolio_review.upsert",
        entityType: "review_meeting",
        entityId: id,
        before: { items: existing.length } as any,
        after: { items: out.length } as any,
        ...meta,
      });
      return out;
    });

    // Touch inArray to avoid unused-import warning
    void inArray;
    return NextResponse.json({ items: updated });
  } catch (err: any) {
    return handleApiError(err);
  }
}
