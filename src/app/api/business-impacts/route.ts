import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { businessImpacts, investors } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { investorScopeCondition } from "@/lib/investors/access";
import { recordAudit } from "@/lib/audit";
import { handleApiError } from "@/lib/api/error-handler";

export const dynamic = "force-dynamic";

const Body = z.object({
  investorId: z.string().uuid(),
  sourceType: z.enum(["workflow", "campaign", "next_best_action", "service", "meeting", "manual"]).default("manual"),
  sourceId: z.string().uuid().nullable().optional(),
  outcome: z.enum(["aum_protected", "aum_generated", "sip_recovered", "sip_started", "referral_won", "service_recovery"]),
  amount: z.number().nonnegative().max(1_000_000_000).default(0),
  monthlySipAmount: z.number().nonnegative().max(10_000_000).default(0),
  note: z.string().trim().max(1000).optional(),
});

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "investor.view.all", session.permissions);
    const investorId = req.nextUrl.searchParams.get("investorId");
    const rows = await withTenant(session.tenantId, async (tx) =>
      tx.select().from(businessImpacts)
        .where(investorId ? eq(businessImpacts.investorId, investorId) : undefined)
        .orderBy(desc(businessImpacts.occurredAt))
        .limit(100)
    );
    return NextResponse.json({ impacts: rows });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "investor.note.add", session.permissions);
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "invalid input", issues: parsed.error.issues }, { status: 400 });
    const body = parsed.data;
    const impact = await withTenant(
      session.tenantId,
      async (tx) => {
        const scope = await investorScopeCondition(tx, session);
        const [investor] = await tx.select({ id: investors.id }).from(investors)
          .where(and(eq(investors.id, body.investorId), ...(scope ? [scope] : []))).limit(1);
        if (!investor) return null;
        const [row] = await tx.insert(businessImpacts).values({
          tenantId: session.tenantId,
          investorId: body.investorId,
          recordedByUserId: session.userId,
          sourceType: body.sourceType,
          sourceId: body.sourceId ?? null,
          outcome: body.outcome,
          amount: String(body.amount),
          monthlySipAmount: String(body.monthlySipAmount),
          note: body.note,
        }).returning();
        await recordAudit(tx, {
          tenantId: session.tenantId,
          actorUserId: session.userId,
          action: "business_impact.create",
          entityType: "investor",
          entityId: body.investorId,
          after: { sourceType: body.sourceType, outcome: body.outcome, amount: body.amount, monthlySipAmount: body.monthlySipAmount },
        });
        return row;
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );
    if (!impact) return NextResponse.json({ error: "client not found" }, { status: 404 });
    return NextResponse.json({ impact }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
