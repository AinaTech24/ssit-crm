import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/discovery/:id/share — mint a single-use client link (/fd/<token>)
 * for the lead/client to fill the discovery before the meeting. Returns the URL
 * once. Marks the discovery 'shared'.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { financialDiscoveries } from "@/db/schema";
import { createShareToken } from "@/lib/share-tokens";

export const dynamic = "force-dynamic";

const VIEW_CAPS = ["investor.view.all", "investor.view.assigned", "lead.view.all", "lead.view.assigned"] as const;

const Body = z.object({ expiresInDays: z.number().int().min(1).max(60).default(14) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireAny(session.roles, [...VIEW_CAPS], session.permissions);
    const { id } = await params;
    const { expiresInDays } = Body.parse(await req.json().catch(() => ({})));

    const disc = await withTenant(session.tenantId, async (tx) =>
      (await tx.select().from(financialDiscoveries).where(eq(financialDiscoveries.id, id)).limit(1))[0]
    );
    if (!disc) return NextResponse.json({ error: "not found" }, { status: 404 });

    const link = await createShareToken({
      tenantId: session.tenantId,
      kind: "financial_discovery",
      subjectType: disc.subjectType as "lead" | "investor",
      subjectId: disc.subjectId,
      payload: { discoveryId: id },
      expiresInDays,
      createdBy: session.userId,
    });

    await withTenant(session.tenantId, (tx) =>
      tx
        .update(financialDiscoveries)
        .set({ status: disc.status === "draft" ? "shared" : disc.status, sharedAt: new Date(), lastShareTokenId: link.id, updatedAt: new Date() } as any)
        .where(and(eq(financialDiscoveries.id, id), eq(financialDiscoveries.tenantId, session.tenantId)))
    );

    return NextResponse.json({ url: link.url, expiresAt: link.expiresAt });
  } catch (err: any) {
    return handleApiError(err);
  }
}
