import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/ai/meeting-summary
 * Body: { notes, agenda?, meetingType?, durationMinutes?, clientName? }
 *
 * Used by the review meeting detail page "AI summarise" button. Returns
 * structured summary + action items the RM can promote to tasks. The
 * RM reviews + accepts before persistence — AI never auto-writes notes.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { summariseMeeting } from "@/lib/ai/assistant";

export const dynamic = "force-dynamic";

const Body = z.object({
  notes: z.string().min(20).max(20000),
  agenda: z.string().optional(),
  meetingType: z.string().optional(),
  durationMinutes: z.number().int().positive().optional(),
  clientName: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "review_meeting.manage.all", session.permissions);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json(
        { error: "invalid body", issues: parse.error.issues },
        { status: 400 }
      );
    }
    const result = await summariseMeeting(parse.data);
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
