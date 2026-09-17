import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/investors/[id]/verify-contact — mark a client's email / phone as
 * verified (or clear it). Sanchay "Verified At" parity. Audit-logged.
 *
 * Body: { channel: "email" | "phone", verified: boolean }
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { investors } from "@/db/schema";
import { assertInScope } from "@/lib/auth/data-scope";

export const dynamic = "force-dynamic";

const Body = z.object({
  channel: z.enum(["email", "phone"]),
  verified: z.boolean().default(true),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    // Marking a client's email/phone as verified mutates KYC-grade contact
    // state — gate behind client-edit capability, not merely an authenticated
    // session (audit: tenant-scoped but RBAC-ungated mutation).
    requireAny(session.roles, ["investor.edit.all", "investor.edit.assigned"], session.permissions);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const { channel, verified } = parse.data;
    const meta = clientMetaFromHeaders(req.headers);
    const stamp = verified ? new Date() : null;

    const result = await withTenant(session.tenantId, async (tx) => {
      const [before] = await tx
        .select({ branchId: investors.branchId, rmId: investors.rmId, serviceRmId: investors.serviceRmId })
        .from(investors)
        .where(and(eq(investors.id, id), eq(investors.tenantId, session.tenantId)))
        .limit(1);
      if (!before) return null;
      await assertInScope(tx, session, { branchId: before.branchId, ownerId: [before.rmId, before.serviceRmId] }, "client");

      const patch: any = { contactVerifiedBy: verified ? session.userId : null, updatedAt: new Date() };
      if (channel === "email") patch.emailVerifiedAt = stamp;
      else patch.phoneVerifiedAt = stamp;
      const next = await tx
        .update(investors)
        .set(patch)
        .where(and(eq(investors.id, id), eq(investors.tenantId, session.tenantId)))
        .returning();
      if (!next[0]) return null;
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "investor.verify_contact",
        entityType: "investor",
        entityId: id,
        after: { channel, verified } as any,
        ...meta,
      });
      return next[0];
    });
    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
