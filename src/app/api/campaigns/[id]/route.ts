import { handleApiError } from "@/lib/api/error-handler";
/**
 * Single campaign endpoints.
 *
 *   GET    /api/campaigns/[id]   — fetch one campaign
 *   PATCH  /api/campaigns/[id]   — update name/segment/template (draft only)
 *   DELETE /api/campaigns/[id]   — cancel (status='cancelled'). Refuse if already sending.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { campaigns } from "@/db/schema";

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

const Patch = z.object({
  name: z.string().min(2).max(200).optional(),
  description: z.string().optional(),
  kind: KIND.optional(),
  theme: z.string().max(200).optional(),
  segmentId: z.string().uuid().optional(),
  templateId: z.string().uuid().optional(),
  variantTemplateId: z.string().uuid().nullable().optional(),
  abSplitPct: z.number().int().min(0).max(100).optional(),
  abWinner: z.enum(["a", "b"]).nullable().optional(),
  recurrence: z.enum(["none", "daily", "weekly", "monthly"]).optional(),
  recurrenceUntil: z.string().nullable().optional(),
  targetAudience: z.string().max(300).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  scheduledAt: z.string().optional(),
  status: z.enum(["draft", "scheduled", "cancelled"]).optional(),
  contentStatus: z.enum(["not_started", "drafting", "ready", "published"]).optional(),
  complianceCheckStatus: z.enum(["pending", "cleared", "blocked", "not_required"]).optional(),
  approvalStatus: z.enum(["pending", "approved", "rejected", "not_required"]).optional(),
  leadsGenerated: z.number().int().min(0).optional(),
  meetingsBooked: z.number().int().min(0).optional(),
  clientsConverted: z.number().int().min(0).optional(),
  campaignCost: z.number().min(0).optional(),
  remarks: z.string().max(1000).optional(),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "campaign.send", session.permissions);
    const row = await withTenant(session.tenantId, async (tx) =>
      (await tx.select().from(campaigns).where(and(eq(campaigns.id, id), eq(campaigns.tenantId, session.tenantId))).limit(1))[0] ?? null
    );
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(row);
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "campaign.send", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = Patch.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const clientMeta = clientMetaFromHeaders(req.headers);

    const result = await withTenant(session.tenantId, async (tx) => {
      const before = (await tx.select().from(campaigns).where(and(eq(campaigns.id, id), eq(campaigns.tenantId, session.tenantId))).limit(1))[0];
      if (!before) return null;
      // Block edits to send-mechanics fields once sending — but allow updating
      // ROI metrics (leads_generated, meetings_booked, clients_converted, remarks).
      const sendingLocked = ["sending", "completed"].includes(before.status as string);
      const sendMechanicsKeys = ["segmentId", "templateId", "variantTemplateId", "abSplitPct", "scheduledAt", "status", "channel"];
      if (sendingLocked) {
        const touchesSendMechanics = sendMechanicsKeys.some((k) => k in (parse.data as any));
        if (touchesSendMechanics) {
          throw Object.assign(new Error(`cannot edit ${before.status} campaign`), { status: 409 });
        }
      }

      // Coerce dates + numeric fields
      const patch: any = { ...parse.data, updatedAt: new Date() };
      if (patch.startDate) patch.startDate = new Date(patch.startDate);
      if (patch.endDate) patch.endDate = new Date(patch.endDate);
      if (patch.scheduledAt) patch.scheduledAt = new Date(patch.scheduledAt);
      if (patch.recurrenceUntil) patch.recurrenceUntil = new Date(patch.recurrenceUntil);
      if (patch.campaignCost != null) patch.campaignCost = String(patch.campaignCost);
      // Stamp approval timestamp when status flips to 'approved'
      if (patch.approvalStatus === "approved" && before.approvalStatus !== "approved") {
        patch.approvedAt = new Date();
        patch.approvedByUserId = session.userId;
      }

      const r = await tx.update(campaigns).set(patch).where(and(eq(campaigns.id, id), eq(campaigns.tenantId, session.tenantId))).returning();
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "campaign.update",
        entityType: "campaign",
        entityId: id,
        after: parse.data as any,
        ...clientMeta,
      });
      return r[0];
    });
    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "campaign.send", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const clientMeta = clientMetaFromHeaders(req.headers);
    await withTenant(session.tenantId, async (tx) => {
      const before = (await tx.select().from(campaigns).where(and(eq(campaigns.id, id), eq(campaigns.tenantId, session.tenantId))).limit(1))[0];
      if (!before) return;
      if (before.status === "sending") {
        throw Object.assign(new Error("cannot delete a campaign already sending"), { status: 409 });
      }
      await tx
        .update(campaigns)
        .set({ status: "cancelled", updatedAt: new Date() } as any)
        .where(and(eq(campaigns.id, id), eq(campaigns.tenantId, session.tenantId)));
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "campaign.cancel",
        entityType: "campaign",
        entityId: id,
        ...clientMeta,
      });
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
