import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/campaigns/[id]/recompute-roi
 *
 * Recomputes attributed ROI (meetings booked + clients converted) for the
 * campaign from its `communications` + downstream meetings/conversions, and
 * persists it. Lets a marketer refresh the numbers on demand; the dispatcher
 * also calls the same routine automatically when a campaign completes.
 */

import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { recomputeCampaignRoi } from "@/lib/campaigns/roi";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "campaign.send", session.permissions);
    const roi = await withTenant(session.tenantId, async (tx) => recomputeCampaignRoi(tx, session.tenantId, id));
    return NextResponse.json({ ok: true, ...roi });
  } catch (err: any) {
    return handleApiError(err);
  }
}
