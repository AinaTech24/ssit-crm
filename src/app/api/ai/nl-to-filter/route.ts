import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/ai/nl-to-filter
 * Body: { query: string, subject?: 'investor'|'lead'|'task' }
 *
 * Used by the filter builder UI and the smart-search bar.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { nlToFilterAst } from "@/lib/ai/assistant";

export const dynamic = "force-dynamic";

const Body = z.object({
  query: z.string().min(2).max(2000),
  subject: z.enum(["investor", "lead", "task"]).default("investor"),
});

export async function POST(req: NextRequest) {
  try {
    await requireSession();
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const result = await nlToFilterAst(parse.data.query, parse.data.subject);
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
