import { handleApiError } from "@/lib/api/error-handler";
/**
 * Lead blueprint endpoints.
 *
 *   GET    /api/leads/[id]/blueprint            → { current, allStages, history }
 *   POST   /api/leads/[id]/blueprint/advance    → transition to a target stage
 */

import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { getStage } from "@/lib/blueprints/engine";
import { loadViewableLead } from "@/lib/leads/access";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const data = await withTenant(session.tenantId, async (tx) => {
      const lead = await loadViewableLead(tx, session, id);
      if (!lead) throw Object.assign(new Error("Lead not found"), { status: 404 });
      const stage = await getStage(tx, session.tenantId, id);
      // Surface the lead's deterministic score + band so the blueprint bar can
      // show "how hot is this lead" right where the RM works the journey.
      return { ...stage, leadScore: (lead as any).leadScore ?? null, scoreBand: (lead as any).scoreBand ?? null };
    });
    return NextResponse.json(data);
  } catch (err: any) {
    return handleApiError(err);
  }
}
