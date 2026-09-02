import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/share-tokens
 *   Body: { kind, subjectType, subjectId, payload?, expiresInDays? }
 *   Returns: { token, url, expiresAt }   ← token is plaintext, ONE TIME.
 *
 * RM uses this to mint risk-profile / docs / proposal-approval / onboarding-progress public links.
 * Also advances the lead's blueprint stage so the progress bar reflects that
 * the form has been sent (risk_profile_sent / docs_requested / proposal_sent).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { createShareToken } from "@/lib/share-tokens";
import { transitionTo } from "@/lib/blueprints/engine";
import { eq } from "drizzle-orm";
import { proposals } from "@/db/schema";

export const dynamic = "force-dynamic";

const Body = z.object({
  kind: z.enum(["risk_profile", "document_collection", "proposal_approval", "onboarding_progress"]),
  subjectType: z.enum(["lead", "investor", "proposal"]),
  subjectId: z.string().uuid(),
  payload: z.record(z.string(), z.unknown()).optional(),
  expiresInDays: z.number().int().min(1).max(30).optional(),
});

/** Map share-token kind → blueprint stage_key to advance the lead to. */
const KIND_TO_LEAD_STAGE: Record<string, string> = {
  risk_profile: "risk_profile_sent",
  document_collection: "docs_requested",
  proposal_approval: "proposal_sent",
};

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "lead.edit.assigned", session.permissions);

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const res = await createShareToken({
      tenantId: session.tenantId,
      kind: parsed.data.kind,
      subjectType: parsed.data.subjectType,
      subjectId: parsed.data.subjectId,
      payload: parsed.data.payload,
      expiresInDays: parsed.data.expiresInDays,
      createdBy: session.userId,
    });

    // Advance the lead's blueprint to the matching "sent" stage so the
    // progress bar moves the moment the RM shares a link.
    const targetStage = KIND_TO_LEAD_STAGE[parsed.data.kind];
    if (targetStage) {
      await withTenant(session.tenantId, async (tx) => {
        // For proposal_approval the subjectId is the proposal id, not the
        // lead id. Look up the underlying lead.
        let leadId: string | null = null;
        if (parsed.data.subjectType === "lead") {
          leadId = parsed.data.subjectId;
        } else if (parsed.data.subjectType === "proposal") {
          const [p] = await tx.select().from(proposals).where(eq(proposals.id, parsed.data.subjectId));
          leadId = (p as any)?.leadId ?? null;
        }
        if (!leadId) return;
        try {
          await transitionTo(tx, session.tenantId, leadId, targetStage, {
            actorUserId: session.userId,
            actorRoles: session.roles ?? [],
            systemBypass: true,
            remarks: `Shared ${parsed.data.kind.replace(/_/g, " ")} link with client.`,
          });
        } catch (e) {
          // Don't fail the token creation if blueprint advance fails.
          console.error("[share-tokens] blueprint advance failed:", e);
        }
      });
    }

    return NextResponse.json(res, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
