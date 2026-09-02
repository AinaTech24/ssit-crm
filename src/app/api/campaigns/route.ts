import { handleApiError } from "@/lib/api/error-handler";
/**
 * Campaigns collection.
 *
 *   GET  /api/campaigns         — list campaigns
 *   POST /api/campaigns         — create new campaign (draft)
 *
 * Same shape for email + whatsapp + sms broadcasts. The actual dispatch is
 * triggered by /api/campaigns/[id]/launch, which fans out via the workflow
 * runner so per-recipient consent + compliance + throttling happens through
 * the standard pipeline (no shortcut).
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { campaigns, segmentMemberships } from "@/db/schema";

export const dynamic = "force-dynamic";

const KIND = z.enum([
  "social_media",
  "whatsapp",
  "email",
  "webinar",
  "seminar",
  "referral",
  "google_business",
  "paid_ads",
  "sms",
  "content",
  "other",
]);

const CONTENT_STATUS = z.enum(["not_started", "drafting", "ready", "published"]);
const COMPLIANCE_STATUS = z.enum(["pending", "cleared", "blocked", "not_required"]);
const APPROVAL_STATUS = z.enum(["pending", "approved", "rejected", "not_required"]);

const CreateBody = z.object({
  name: z.string().min(2).max(120),
  description: z.string().optional(),
  /** Marketing campaign type (spec). Optional — legacy broadcasts pass only channel. */
  kind: KIND.optional(),
  theme: z.string().max(200).optional(),
  /** Broadcast channel. Required for legacy broadcast kinds (whatsapp/email/sms). */
  channel: z.enum(["email", "whatsapp", "sms"]).optional(),
  templateId: z.string().uuid().optional(),
  templateVersionId: z.string().uuid().optional(),
  /** A/B testing — optional second template + the % of the audience to send it to. */
  variantTemplateId: z.string().uuid().optional(),
  abSplitPct: z.number().int().min(0).max(100).optional(),
  segmentId: z.string().uuid().optional(),
  targetAudience: z.string().max(300).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  scheduledAt: z.string().datetime().optional(),
  /** Recurrence — repeat the campaign automatically until `recurrenceUntil`. */
  recurrence: z.enum(["none", "daily", "weekly", "monthly"]).optional(),
  recurrenceUntil: z.string().optional(),
  throttlePerMinute: z.number().int().min(1).max(1000).default(60),
  contentStatus: CONTENT_STATUS.optional(),
  complianceCheckStatus: COMPLIANCE_STATUS.optional(),
  approvalStatus: APPROVAL_STATUS.optional(),
  leadsGenerated: z.number().int().min(0).optional(),
  meetingsBooked: z.number().int().min(0).optional(),
  clientsConverted: z.number().int().min(0).optional(),
  campaignCost: z.number().min(0).optional(),
  remarks: z.string().max(1000).optional(),
});

export async function GET() {
  try {
    const session = await requireSession();
    requireCap(session.roles, "campaign.send", session.permissions);
    const rows = await withTenant(session.tenantId, async (tx) => {
      return tx
        .select()
        .from(campaigns)
        .where(eq(campaigns.tenantId, session.tenantId))
        .orderBy(desc(campaigns.createdAt));
    });
    return NextResponse.json({ campaigns: rows });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "campaign.send", session.permissions);
    const parse = CreateBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const body = parse.data;

    const id = uuid();

    // Decide whether this is a "broadcast" campaign (template+segment present)
    // or a "marketing campaign" log (webinar / seminar / social etc.).
    const isBroadcast = Boolean(body.channel && body.templateId && body.segmentId);
    const channel = body.channel ?? (body.kind === "whatsapp" || body.kind === "email" || body.kind === "sms" ? body.kind : "email");
    // Default kind from channel for legacy callers.
    const kind = body.kind ?? body.channel ?? "other";

    await withTenant(session.tenantId, async (tx) => {
      let total = 0;
      if (body.segmentId) {
        const countRes = await tx
          .select({ c: sql<number>`count(*)::int` })
          .from(segmentMemberships)
          .where(
            and(
              eq(segmentMemberships.segmentId, body.segmentId),
              eq(segmentMemberships.tenantId, session.tenantId),
              sql`${segmentMemberships.removedAt} IS NULL`
            )
          );
        total = Number(countRes[0]?.c ?? 0);
      }

      await tx.insert(campaigns).values({
        id,
        tenantId: session.tenantId,
        name: body.name,
        description: body.description,
        kind: kind as any,
        theme: body.theme,
        channel: channel as any,
        templateId: body.templateId ?? null,
        templateVersionId: body.templateVersionId ?? null,
        variantTemplateId: body.variantTemplateId ?? null,
        abSplitPct: body.abSplitPct ?? 50,
        segmentId: body.segmentId ?? null,
        targetAudience: body.targetAudience,
        status: isBroadcast && body.scheduledAt ? "scheduled" : "draft",
        startDate: body.startDate ? new Date(body.startDate) : null,
        endDate: body.endDate ? new Date(body.endDate) : null,
        scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null,
        recurrence: body.recurrence ?? "none",
        recurrenceUntil: body.recurrenceUntil ? new Date(body.recurrenceUntil) : null,
        totalRecipients: total,
        throttlePerMinute: body.throttlePerMinute,
        contentStatus: body.contentStatus ?? "not_started",
        complianceCheckStatus: body.complianceCheckStatus ?? "pending",
        // A campaign cannot self-approve at create time — approval is a separate,
        // audited step (PATCH) before it can be launched.
        approvalStatus: body.approvalStatus === "approved" ? "pending" : (body.approvalStatus ?? "pending"),
        leadsGenerated: body.leadsGenerated ?? 0,
        meetingsBooked: body.meetingsBooked ?? 0,
        clientsConverted: body.clientsConverted ?? 0,
        campaignCost: body.campaignCost != null ? String(body.campaignCost) : null,
        remarks: body.remarks,
        createdByUserId: session.userId,
      } as any);
    });

    return NextResponse.json({ id }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
