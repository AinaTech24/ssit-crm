import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/campaigns/[id]/test-send
 *   body: { recipient?: string, variant?: "a" | "b" }
 *
 * Sends ONE copy of the campaign's template to a test recipient (the requesting
 * user by default) so the marketer can eyeball the real rendered message before
 * launching to the whole audience. It runs the full comms pipeline (render →
 * consent → compliance gate) exactly like a real send — the only difference is
 * there's no campaignId stamped, so the test never pollutes the campaign's
 * funnel counters, and no investor context (so no consent / frequency-cap skip).
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { campaigns, templates, users } from "@/db/schema";
import { dispatch } from "@/lib/comms/pipeline";

export const dynamic = "force-dynamic";

const Body = z.object({
  recipient: z.string().trim().min(3).max(200).optional(),
  variant: z.enum(["a", "b"]).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "campaign.send", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const { recipient: recipientOverride, variant } = parsed.data;

    const out = await withTenant(session.tenantId, async (tx) => {
      const [c] = await tx.select().from(campaigns).where(and(eq(campaigns.id, id), eq(campaigns.tenantId, session.tenantId))).limit(1);
      if (!c) return { kind: "not_found" as const };

      // Pick the variant's template (defaults to the primary template / variant A).
      const templateId = variant === "b" ? c.variantTemplateId : c.templateId;
      if (!templateId) {
        return { kind: "error" as const, status: 422, message: variant === "b" ? "This campaign has no B variant to test." : "This campaign has no template attached to test." };
      }
      const [tpl] = await tx.select().from(templates).where(and(eq(templates.id, templateId), eq(templates.tenantId, session.tenantId))).limit(1);
      if (!tpl) return { kind: "error" as const, status: 422, message: "Linked template not found." };

      // Resolve the test recipient: explicit override, else the requesting user's
      // own email (email channel) or phone (whatsapp/sms).
      let recipient = recipientOverride ?? "";
      if (!recipient) {
        if (c.channel === "email") {
          recipient = session.email ?? "";
        } else {
          const [u] = await tx.select({ phone: users.phone }).from(users).where(and(eq(users.id, session.userId), eq(users.tenantId, session.tenantId))).limit(1);
          recipient = u?.phone ?? "";
        }
      }
      if (!recipient) {
        return {
          kind: "error" as const,
          status: 422,
          message: c.channel === "email"
            ? "No email address to send the test to — add one to your profile or enter one."
            : "No phone number to send the test to — add one to your profile or enter one.",
        };
      }

      const result = await dispatch(tx, {
        tenantId: session.tenantId,
        channel: c.channel as any,
        templateKey: tpl.key,
        recipient,
        variables: { name: session.name ?? "there" },
        category: "marketing",
        actorUserId: session.userId,
        meta: { test: true, campaignName: c.name },
        // NB: no campaignId / investorId — keeps the test out of the funnel.
      } as any);

      return { kind: "ok" as const, recipient, result };
    });

    if (out.kind === "not_found") return NextResponse.json({ error: "not found" }, { status: 404 });
    if (out.kind === "error") return NextResponse.json({ error: out.message }, { status: out.status });

    if (out.result.status === "skipped") {
      return NextResponse.json(
        { ok: false, skipped: out.result.skipped, recipient: out.recipient, error: `Test not sent — ${out.result.skipped?.reason?.replace(/_/g, " ") ?? "blocked by a pre-send check"}.` },
        { status: 200 }
      );
    }
    return NextResponse.json({ ok: true, status: out.result.status, recipient: out.recipient });
  } catch (err: any) {
    return handleApiError(err);
  }
}
