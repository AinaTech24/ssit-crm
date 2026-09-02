/**
 * POST /api/segments/adhoc
 *
 * Builds a throwaway campaign audience (segment + materialized members) without
 * the Segments module — Zoho-style "select recipients" for a broadcast.
 *
 * Body: { subjectType, mode, subjectIds?, ast?, name? }
 *   mode = "all"    → every investor / lead in the tenant
 *        = "manual" → the given subjectIds
 *        = "filter" → a Filter AST
 *
 * Returns: { segmentId, memberCount }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { createAdhocAudience } from "@/lib/campaigns/audience";

export const dynamic = "force-dynamic";

const Body = z.object({
  subjectType: z.enum(["investor", "lead"]),
  mode: z.enum(["all", "manual", "filter"]),
  subjectIds: z.array(z.string().uuid()).optional(),
  ast: z.any().optional(),
  name: z.string().max(120).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "campaign.send", session.permissions);

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const { subjectType, mode, subjectIds, ast, name } = parsed.data;

    if (mode === "manual" && (!subjectIds || subjectIds.length === 0)) {
      return NextResponse.json({ error: "Pick at least one recipient." }, { status: 400 });
    }
    if (mode === "filter" && !ast) {
      return NextResponse.json({ error: "filter mode requires an ast" }, { status: 400 });
    }

    const result = await createAdhocAudience({
      tenantId: session.tenantId,
      subjectType,
      mode,
      subjectIds,
      ast,
      name,
    });

    if (result.memberCount === 0) {
      return NextResponse.json(
        { error: "That audience has 0 recipients. Adjust your selection.", ...result },
        { status: 422 }
      );
    }

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
