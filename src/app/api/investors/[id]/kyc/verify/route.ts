import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/investors/[id]/kyc/verify
 *   Runs the configured KYC provider (or stub) for this client and writes the
 *   result back onto the investor (kyc status, CKYC number, name-as-per-PAN,
 *   PAN-Aadhaar link). Turns days of manual transcription into one click.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { investors } from "@/db/schema";
import { verifyKyc } from "@/lib/kyc/verify";
import { autoAdvance, resolveLeadIdForInvestor } from "@/lib/blueprints/auto-advance";

/** Client-phase stages BEFORE "KYC Validated" — only from one of these does a
 *  verified KYC advance the journey, so re-running verify on an already-active
 *  client never drags the blueprint backward. */
const PRE_KYC_STAGES = new Set([
  "request_documents", "documents_pending", "documents_received",
  "kyc_registered", "kyc_pending", "modify_kyc", "physical_kyc", "online_kyc",
]);

export const dynamic = "force-dynamic";

const STATUS_MAP: Record<string, string> = {
  verified: "verified",
  not_found: "pending",
  mismatch: "hold",
  pending: "pending",
  error: "pending",
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["investor.edit.all", "investor.edit.assigned"], session.permissions);
    const clientMeta = clientMetaFromHeaders(req.headers);

    const result = await withTenant(
      session.tenantId,
      async (tx) => {
        const [inv] = await tx
          .select()
          .from(investors)
          .where(and(eq(investors.id, id), eq(investors.tenantId, session.tenantId)))
          .limit(1);
        if (!inv) return null;

        const r = await verifyKyc({
          pan: inv.pan,
          name: inv.name,
          dob: (inv as any).dob ?? null,
          aadhaarLast4: (inv as any).aadhaarLast4 ?? null,
        });

        const patch: any = { kycStatus: STATUS_MAP[r.status] ?? "pending", kycLastUpdatedBy: session.userId, updatedAt: new Date() };
        if (r.status === "verified") {
          patch.kycValidatedAt = new Date();
          if (r.ckycNumber) patch.ckycNumber = r.ckycNumber;
          if (r.nameAsPerPan) patch.nameAsPerPan = r.nameAsPerPan;
          if (r.panAadhaarLinked != null) patch.panAadhaarLinkStatus = r.panAadhaarLinked ? "linked" : "not_linked";
        }
        await tx.update(investors).set(patch).where(eq(investors.id, id));

        // Auto-advance the Lead → Client journey to "KYC Validated" — but ONLY
        // when the client is still in a pre-validation onboarding stage, so a
        // re-KYC on an active client can't pull the blueprint backwards.
        if (r.status === "verified") {
          try {
            const leadId = await resolveLeadIdForInvestor(tx, id);
            if (leadId) {
              const cur = await tx.execute(
                sql`SELECT current_stage_key FROM lead_blueprint_instances WHERE tenant_id = ${session.tenantId}::uuid AND lead_id = ${leadId}::uuid LIMIT 1`
              );
              const stage = (cur.rows[0] as any)?.current_stage_key as string | undefined;
              if (stage && PRE_KYC_STAGES.has(stage)) {
                await autoAdvance(tx, session.tenantId, leadId, "kyc.validated", {
                  remarks: "Auto: KYC verified via provider.",
                });
              }
            }
          } catch {
            /* best-effort — never block the KYC write on a blueprint hiccup */
          }
        }

        await recordAudit(tx, {
          tenantId: session.tenantId,
          actorUserId: session.userId,
          action: "investor.kyc.verify",
          entityType: "investor",
          entityId: id,
          after: { provider: r.provider, status: r.status, ckycNumber: r.ckycNumber, kycStatus: patch.kycStatus },
          ...clientMeta,
        });
        return { ok: true, provider: r.provider, status: r.status, kycStatus: patch.kycStatus, ckycNumber: r.ckycNumber ?? null, message: r.message };
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
