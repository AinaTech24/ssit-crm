import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/ai/circular-summary
 * Body: { text, issuerHint? }
 *
 * Turns a pasted AMFI/SEBI/CBDT circular into a distributor-friendly digest
 * (title, summary, MFD actions, category, severity). Compliance/owner use it to
 * draft amfi_circulars entries. Does NOT persist — returns the draft for review.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { summariseCircular } from "@/lib/ai/assistant";

export const dynamic = "force-dynamic";

const Body = z.object({
  text: z.string().min(40).max(20000),
  issuerHint: z.string().max(40).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["compliance.view", "compliance.edit", "reports.business"], session.permissions);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const result = await summariseCircular(parse.data);
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
