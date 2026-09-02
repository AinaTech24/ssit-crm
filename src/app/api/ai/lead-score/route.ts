import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/ai/lead-score
 * Body: { name, source?, stage?, ageInStageDays?, lastTouchDaysAgo?,
 *         callsCount?, meetingsCount?, emailOpens?, whatsappReplies?,
 *         estimatedAumInr?, notes? }
 *
 * Used by the lead detail page "AI score" button + bulk leads list re-score.
 * Returns { score 0-100, band, reasoning, nextAction }. AI is advisory —
 * caller decides whether to persist on the lead row (we don't write here).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { scoreLead } from "@/lib/ai/assistant";

export const dynamic = "force-dynamic";

const Body = z.object({
  name: z.string().min(1).max(200),
  source: z.string().optional(),
  stage: z.string().optional(),
  ageInStageDays: z.number().int().nonnegative().optional(),
  lastTouchDaysAgo: z.number().int().nonnegative().optional(),
  callsCount: z.number().int().nonnegative().optional(),
  meetingsCount: z.number().int().nonnegative().optional(),
  emailOpens: z.number().int().nonnegative().optional(),
  whatsappReplies: z.number().int().nonnegative().optional(),
  estimatedAumInr: z.number().nonnegative().optional(),
  notes: z.string().max(5000).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["lead.edit.all", "lead.edit.assigned"], session.permissions);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json(
        { error: "invalid body", issues: parse.error.issues },
        { status: 400 }
      );
    }
    const result = await scoreLead(parse.data);
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
