import { NextRequest, NextResponse } from "next/server";
import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { investorPortalAccess, investors } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { investorScopeCondition } from "@/lib/investors/access";
import { issuePortalAccess } from "@/lib/portal/access";
import { recordAudit } from "@/lib/audit";
import { handleApiError } from "@/lib/api/error-handler";

export const dynamic = "force-dynamic";

const IssueBody = z.object({ expiresInDays: z.number().int().min(1).max(90).default(30) });

async function authorizeInvestor(id: string) {
  const session = await requireSession();
  requireAny(session.roles, ["investor.edit.all", "investor.edit.assigned"], session.permissions);
  const investor = await withTenant(
    session.tenantId,
    async (tx) => {
      const scope = await investorScopeCondition(tx, session);
      const [row] = await tx
        .select({ id: investors.id, name: investors.name })
        .from(investors)
        .where(and(eq(investors.id, id), ...(scope ? [scope] : [])))
        .limit(1);
      return row ?? null;
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );
  return { session, investor };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { session, investor } = await authorizeInvestor(id);
    if (!investor) return NextResponse.json({ error: "not found" }, { status: 404 });
    const access = await withTenant(session.tenantId, async (tx) => {
      const [row] = await tx
        .select({ expiresAt: investorPortalAccess.expiresAt, lastAccessedAt: investorPortalAccess.lastAccessedAt })
        .from(investorPortalAccess)
        .where(
          and(
            eq(investorPortalAccess.investorId, id),
            isNull(investorPortalAccess.revokedAt),
            gt(investorPortalAccess.expiresAt, new Date())
          )
        )
        .limit(1);
      return row ?? null;
    });
    return NextResponse.json({ active: !!access, access });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { session, investor } = await authorizeInvestor(id);
    if (!investor) return NextResponse.json({ error: "not found" }, { status: 404 });
    const parsed = IssueBody.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "invalid input", issues: parsed.error.issues }, { status: 400 });

    const issued = await withTenant(session.tenantId, async (tx) => {
      const result = await issuePortalAccess(tx, {
        tenantId: session.tenantId,
        investorId: id,
        userId: session.userId,
        expiresInDays: parsed.data.expiresInDays,
      });
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "investor.portal.issue",
        entityType: "investor",
        entityId: id,
        after: { expiresAt: result.expiresAt.toISOString(), scopes: ["portfolio", "goals", "service_requests"] },
      });
      return result;
    });

    return NextResponse.json({
      accessUrl: `${req.nextUrl.origin}/portal/${issued.token}`,
      expiresAt: issued.expiresAt.toISOString(),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { session, investor } = await authorizeInvestor(id);
    if (!investor) return NextResponse.json({ error: "not found" }, { status: 404 });
    await withTenant(session.tenantId, async (tx) => {
      await tx
        .update(investorPortalAccess)
        .set({ revokedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(investorPortalAccess.investorId, id), isNull(investorPortalAccess.revokedAt)));
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "investor.portal.revoke",
        entityType: "investor",
        entityId: id,
      });
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}

