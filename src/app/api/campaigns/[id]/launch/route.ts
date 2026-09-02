import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/campaigns/[id]/launch
 *
 * Enforces compliance gate validation before launching campaigns.
 * Transitions a draft/scheduled campaign into 'sending'. The worker process
 * (campaign-dispatcher) picks it up, walks segment_memberships, and dispatches.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { campaigns, templates } from "@/db/schema";
import { isBroadcastCampaign } from "@/lib/campaigns/broadcast";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "campaign.send", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);

    const clientMeta = clientMetaFromHeaders(req.headers);
    const result = await withTenant(session.tenantId, async (tx) => {
      const before = (await tx.select().from(campaigns).where(and(eq(campaigns.id, id), eq(campaigns.tenantId, session.tenantId))).limit(1))[0];
      if (!before) return null;

      // "Intends to broadcast" = has any broadcast config (template/segment) or a
      // broadcast-y kind. A half-configured broadcast errors with guidance rather
      // than silently completing as a non-broadcast log.
      const intendsBroadcast =
        isBroadcastCampaign(before) ||
        Boolean(before.templateId) ||
        Boolean(before.segmentId) ||
        ["whatsapp", "email", "sms"].includes(before.kind ?? "");

      if (intendsBroadcast) {
        if (!before.templateId) {
          throw Object.assign(new Error("Cannot launch broadcast: No template is attached to this campaign."), { status: 422 });
        }
        if (!before.segmentId) {
          throw Object.assign(new Error("Cannot launch broadcast: No audience segment is selected."), { status: 422 });
        }

        const [tpl] = await tx.select().from(templates).where(and(eq(templates.id, before.templateId), eq(templates.tenantId, session.tenantId))).limit(1);
        if (!tpl) {
          throw Object.assign(new Error("Cannot launch broadcast: Linked template not found."), { status: 422 });
        }
        if (tpl.status !== "approved") {
          throw Object.assign(
            new Error(`Cannot launch broadcast: Linked template '${tpl.name}' is currently in '${tpl.status.replace(/_/g, " ")}' status and must be 'approved' first.`),
            { status: 422 }
          );
        }

        // Campaign-level approval gate (audience / timing sign-off) — the field
        // is no longer vestigial. Must be explicitly approved before sending.
        if (before.approvalStatus !== "approved" && before.approvalStatus !== "not_required") {
          throw Object.assign(
            new Error("Cannot launch broadcast: this campaign hasn't been approved yet — approve it first."),
            { status: 422 }
          );
        }
      }

      const r = await tx
        .update(campaigns)
        .set({ status: "sending", startedAt: new Date(), updatedAt: new Date() } as any)
        .where(and(eq(campaigns.id, id), eq(campaigns.tenantId, session.tenantId)))
        .returning();

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "campaign.launch",
        entityType: "campaign",
        entityId: id,
        after: { name: r[0].name, channel: r[0].channel, segmentId: r[0].segmentId },
        ...clientMeta,
      });
      return r[0];
    });

    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (err: any) {
    if (err.status && err.message) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return handleApiError(err);
  }
}
