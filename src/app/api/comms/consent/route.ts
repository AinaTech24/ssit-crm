/**
 * POST /api/comms/consent — record (grant / revoke) a client's communication
 * consent so the comms pipeline lets messages through.
 *   Body: { investorId, channel: whatsapp|email|sms|call, scope: transactional|marketing|all, status: granted|revoked }
 *
 * This captures a real-world opt-in the RM is asserting (verbal/written). Audited.
 * Upserts on (tenant, investor, channel, scope).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { consents } from "@/db/schema";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";

export const dynamic = "force-dynamic";

const Body = z.object({
  investorId: z.string().uuid(),
  channel: z.enum(["whatsapp", "email", "sms", "call"]),
  scope: z.enum(["transactional", "marketing", "all"]).default("all"),
  status: z.enum(["granted", "revoked"]).default("granted"),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    // Consent is the compliance record that gates every outbound message
    // (SEBI/DPDP). Writing it must be a deliberate, capability-gated action —
    // not something any logged-in user can flip.
    requireCap(session.roles, "consent.manage", session.permissions);
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid input", issues: parsed.error.issues }, { status: 400 });
    }
    const { investorId, channel, scope, status } = parsed.data;
    const meta = clientMetaFromHeaders(req.headers);
    const now = new Date();

    await withTenant(session.tenantId, async (tx) => {
      const [existing] = await tx
        .select({ id: consents.id })
        .from(consents)
        .where(
          and(
            eq(consents.tenantId, session.tenantId),
            eq(consents.investorId, investorId),
            eq(consents.channel, channel),
            eq(consents.scope, scope)
          )
        );

      const values = {
        status,
        grantedAt: status === "granted" ? now : null,
        revokedAt: status === "revoked" ? now : null,
        source: "manual",
        updatedAt: now,
      } as any;

      if (existing) {
        await tx.update(consents).set(values).where(eq(consents.id, existing.id));
      } else {
        await tx.insert(consents).values({
          tenantId: session.tenantId,
          investorId,
          channel,
          scope,
          ...values,
        } as any);
      }

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: status === "granted" ? "consent.grant" : "consent.revoke",
        entityType: "investor",
        entityId: investorId,
        after: { channel, scope, status } as any,
        ...meta,
      });
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
