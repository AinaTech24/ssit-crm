import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET   /api/discovery/:id   — load one discovery
 * PATCH /api/discovery/:id   — save fact-find data; recomputes the snapshot +
 *                              health score server-side and caches it.
 *
 * Gated to lead/client viewers. Tenant-scoped via RLS.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { financialDiscoveries } from "@/db/schema";
import { computeDiscovery, type DiscoveryData } from "@/lib/discovery/calc";

export const dynamic = "force-dynamic";

const VIEW_CAPS = ["investor.view.all", "investor.view.assigned", "lead.view.all", "lead.view.assigned"] as const;

const PatchBody = z.object({
  data: z.any().optional(),
  status: z.enum(["draft", "shared", "submitted", "reviewed"]).optional(),
  reviewType: z.string().max(80).optional(),
  markReviewed: z.boolean().optional(),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireAny(session.roles, [...VIEW_CAPS], session.permissions);
    const { id } = await params;
    const row = await withTenant(session.tenantId, async (tx) =>
      (await tx.select().from(financialDiscoveries).where(eq(financialDiscoveries.id, id)).limit(1))[0]
    );
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ discovery: row });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireAny(session.roles, [...VIEW_CAPS], session.permissions);
    const { id } = await params;
    const parsed = PatchBody.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const b = parsed.data;

    const updated = await withTenant(session.tenantId, async (tx) => {
      const existing = (await tx.select().from(financialDiscoveries).where(eq(financialDiscoveries.id, id)).limit(1))[0];
      if (!existing) return null;

      const data: DiscoveryData = (b.data ?? existing.data ?? {}) as DiscoveryData;
      const computed = computeDiscovery(data);
      const patch: Record<string, unknown> = {
        data: data as any,
        computed: computed as any,
        healthScore: computed.healthScore,
        title: (data.identification as any)?.fullName ?? existing.title,
        updatedAt: new Date(),
      };
      if (b.reviewType !== undefined) patch.reviewType = b.reviewType;
      if (b.status) patch.status = b.status;
      if (b.markReviewed) {
        patch.status = "reviewed";
        patch.reviewedAt = new Date();
      }
      const [row] = await tx
        .update(financialDiscoveries)
        .set(patch as any)
        .where(and(eq(financialDiscoveries.id, id), eq(financialDiscoveries.tenantId, session.tenantId)))
        .returning();
      return row;
    });

    if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ discovery: updated });
  } catch (err: any) {
    return handleApiError(err);
  }
}
