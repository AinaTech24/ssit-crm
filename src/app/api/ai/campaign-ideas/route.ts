import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/ai/campaign-ideas
 * Body: { segmentId } | { segmentName, subject, segmentDescription?, sampleSize?, fieldsSummary? }
 *
 * Used by the segment detail page "Brainstorm campaigns" button. Returns
 * 3 distinct campaign concepts (objective, channel mix, sample copy).
 * Caller decides whether to materialise any of them as a Campaign.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { segments } from "@/db/schema";
import { generateCampaignIdeas } from "@/lib/ai/assistant";

export const dynamic = "force-dynamic";

const Body = z.union([
  z.object({ segmentId: z.string().uuid() }),
  z.object({
    segmentName: z.string().min(1),
    subject: z.enum(["investor", "lead"]),
    segmentDescription: z.string().optional(),
    sampleSize: z.number().int().nonnegative().optional(),
    fieldsSummary: z.string().optional(),
  }),
]);

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "campaign.send", session.permissions);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json(
        { error: "invalid body", issues: parse.error.issues },
        { status: 400 }
      );
    }

    let input: Parameters<typeof generateCampaignIdeas>[0];
    const data = parse.data;
    if ("segmentId" in data) {
      const segmentId = data.segmentId;
      input = await withTenant(session.tenantId, async (tx) => {
        const seg = (
          await tx
            .select()
            .from(segments)
            .where(and(eq(segments.id, segmentId), eq(segments.tenantId, session.tenantId)))
            .limit(1)
        )[0];
        if (!seg) throw new Error("segment not found");
        const subjectType = seg.subjectType;
        const subject: "investor" | "lead" =
          subjectType === "lead" ? "lead" : "investor";
        return {
          segmentName: seg.name,
          subject,
          segmentDescription: seg.description ?? undefined,
        };
      });
    } else {
      input = data;
    }

    const result = await generateCampaignIdeas(input);
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
