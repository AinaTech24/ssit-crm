import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/ai/ddq-draft
 * Body: { question, existingAnswerHint? }
 *
 * Used by the DDQ readiness page "AI draft" button on any question card.
 * Pulls tenant profile from the org row to ground the draft. The
 * compliance officer reviews + edits before save — AI never auto-writes
 * to ddq_responses.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { tenants } from "@/db/schema";
import { draftDdqAnswer } from "@/lib/ai/assistant";

export const dynamic = "force-dynamic";

const Body = z.object({
  question: z.string().min(5).max(5000),
  existingAnswerHint: z.string().max(5000).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "compliance.edit", session.permissions);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json(
        { error: "invalid body", issues: parse.error.issues },
        { status: 400 }
      );
    }

    const tenant = await withTenant(session.tenantId, async (tx) => {
      return (
        await tx.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1)
      )[0];
    });
    if (!tenant) {
      return NextResponse.json({ error: "tenant not found" }, { status: 404 });
    }

    const result = await draftDdqAnswer({
      question: parse.data.question,
      existingAnswerHint: parse.data.existingAnswerHint,
      tenantProfile: {
        displayName: tenant.displayName ?? tenant.legalName ?? "the firm",
        arn: tenant.arn,
        euin: tenant.principalEuin ?? null,
        aumRange: tenant.aumRange ?? null,
        teamSize: tenant.teamSize ?? null,
        address: tenant.address,
      },
    });
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
