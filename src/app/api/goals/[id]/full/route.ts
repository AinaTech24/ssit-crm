import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/goals/[id]/full — bundled goal detail for the mobile app.
 *
 * Mirrors the web goal detail page's data load: the goal + its investor
 * (name/PAN/contact) + the investor's folios and active SIPs (for the
 * linked-investments picker). One round-trip.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, desc, isNull } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny, can } from "@/lib/auth/rbac";
import { assertCanViewClient } from "@/lib/investors/access";
import { goals, investors, folios, sips } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["investor.view.all", "investor.view.assigned"], session.permissions);
    const canViewAll = can(session.roles, "investor.view.all", session.permissions);

    const data = await withTenant(
      session.tenantId,
      async (tx) => {
        const goal = (await tx.select().from(goals).where(and(eq(goals.id, id), eq(goals.tenantId, session.tenantId))).limit(1))[0];
        if (!goal) return null;
        const inv = (await tx.select().from(investors).where(eq(investors.id, goal.investorId)).limit(1))[0];
        if (!inv) return { goal, investor: null, folios: [], sips: [] };
        // Non-managers only see their own clients' goals.
        if (!canViewAll) {
          try {
            await assertCanViewClient(tx, session, inv);
          } catch {
            return { forbidden: true as const };
          }
        }

        const fol = await tx
          .select({ id: folios.id, amcName: folios.amcName, folioNumber: folios.folioNumber, aum: folios.aum })
          .from(folios)
          .where(and(eq(folios.investorId, inv.id), isNull(folios.closedAt)))
          .orderBy(desc(folios.aum))
          .limit(100);

        const activeSips = await tx
          .select({ id: sips.id, schemeName: sips.schemeName, amcName: sips.amcName, amount: sips.amount, frequency: sips.frequency, status: sips.status })
          .from(sips)
          .where(and(eq(sips.investorId, inv.id), eq(sips.status, "active")))
          .orderBy(desc(sips.amount))
          .limit(100);

        return {
          goal,
          investor: { id: inv.id, name: inv.name, pan: inv.pan, phone: inv.phone, whatsappPhone: (inv as any).whatsappPhone ?? null, email: inv.email },
          folios: fol,
          sips: activeSips,
        };
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
    if ("forbidden" in data) return NextResponse.json({ error: "you can only view your own clients' goals" }, { status: 403 });
    return NextResponse.json(data);
  } catch (err: any) {
    return handleApiError(err);
  }
}
