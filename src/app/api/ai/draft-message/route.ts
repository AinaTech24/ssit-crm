import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/ai/draft-message
 * Body: { channel, intent, audienceContext?, variables? }
 *
 * Used by template designer "AI draft" button. Output is text; UI re-runs the
 * compliance gate on the resulting draft before the user can save.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { draftMessage } from "@/lib/ai/assistant";

export const dynamic = "force-dynamic";

const Body = z.object({
  channel: z.enum(["whatsapp", "email", "sms"]),
  intent: z.string().min(2).max(2000),
  audienceContext: z.string().optional(),
  variables: z.array(z.string()).optional(),
  theme: z.string().max(40).optional(),
});

export async function POST(req: NextRequest) {
  try {
    await requireSession();
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const result = await draftMessage(parse.data);
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
