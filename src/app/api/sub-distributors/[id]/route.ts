import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET    /api/sub-distributors/[id]  — read one
 * PATCH  /api/sub-distributors/[id]  — partial update
 * DELETE /api/sub-distributors/[id]  — soft-terminate (status=terminated)
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { subDistributors } from "@/db/schema";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";

export const dynamic = "force-dynamic";

const PatchBody = z.object({
  name: z.string().min(1).max(160).optional(),
  code: z.string().max(40).nullable().optional(),
  typeOfAssociation: z
    .enum([
      "individual",
      "firm",
      "channel_partner",
      "referral_partner",
      "internal_referral",
      "other",
    ])
    .optional(),
  city: z.string().max(80).nullable().optional(),
  email: z.string().email().nullable().optional().or(z.literal("")),
  mobile: z.string().max(40).nullable().optional(),
  panNumber: z
    .string()
    .regex(/^[A-Z]{5}\d{4}[A-Z]$/i, "PAN format: ABCDE1234F")
    .nullable()
    .optional()
    .or(z.literal("")),
  nismCertificateNo: z.string().max(80).nullable().optional(),
  nismExamDate: z.string().nullable().optional(),
  nismExpiryAt: z.string().nullable().optional(),
  nismCategory: z.string().max(20).nullable().optional(),
  arnNumber: z
    .string()
    .regex(/^ARN-?\d{1,8}$/i, "ARN format: ARN-XXXXXX")
    .nullable()
    .optional()
    .or(z.literal("")),
  arnRegistrationDate: z.string().nullable().optional(),
  arnExpiryAt: z.string().nullable().optional(),
  euin: z
    .string()
    .regex(/^E\d{6}$/i, "EUIN format: E + 6 digits")
    .nullable()
    .optional()
    .or(z.literal("")),
  euinExpiryAt: z.string().nullable().optional(),
  commissionSplitPct: z.number().min(0).max(100).nullable().optional(),
  bankDetails: z
    .object({
      accountHolder: z.string().optional(),
      accountNumber: z.string().optional(),
      ifsc: z.string().optional(),
      bankName: z.string().optional(),
      branch: z.string().optional(),
      upi: z.string().optional(),
    })
    .nullable()
    .optional(),
  status: z.enum(["active", "inactive", "terminated"]).optional(),
  onboardedAt: z.string().nullable().optional(),
  terminatedAt: z.string().nullable().optional(),
  remarks: z.string().max(4000).nullable().optional(),
  dscOnFile: z.boolean().optional(),
  relationshipManagerId: z.string().uuid().nullable().optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "compliance.edit", session.permissions);
    const { id } = await params;
    const row = await withTenant(session.tenantId, async (tx) => {
      const [r] = await tx
        .select()
        .from(subDistributors)
        .where(eq(subDistributors.id, id))
        .limit(1);
      return r;
    });
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ subDistributor: row });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "compliance.edit", session.permissions);
    const { id } = await params;
    const parse = PatchBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json(
        { error: "invalid body", issues: parse.error.issues },
        { status: 400 }
      );
    }
    const meta = clientMetaFromHeaders(req.headers);
    const body = parse.data;

    const result = await withTenant(session.tenantId, async (tx) => {
      const [existing] = await tx
        .select()
        .from(subDistributors)
        .where(eq(subDistributors.id, id));
      if (!existing) return null;

      const patch: any = { updatedAt: new Date() };
      // Strict field-presence gating — null vs undefined matter.
      for (const k of Object.keys(body) as Array<keyof typeof body>) {
        if (body[k] === undefined) continue;
        if (k === "commissionSplitPct") {
          patch.commissionSplitPct =
            body.commissionSplitPct != null
              ? String(body.commissionSplitPct)
              : null;
        } else if (k === "panNumber") {
          patch.panNumber = body.panNumber ? body.panNumber.toUpperCase() : null;
        } else if (k === "status" && body.status === "terminated") {
          patch.status = "terminated";
          if (!existing.terminatedAt) patch.terminatedAt = new Date().toISOString().slice(0, 10);
        } else {
          patch[k] = body[k] === "" ? null : body[k];
        }
      }

      const [next] = await tx
        .update(subDistributors)
        .set(patch)
        .where(eq(subDistributors.id, id))
        .returning();

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "sub_distributor.update",
        entityType: "sub_distributor",
        entityId: id,
        before: existing,
        after: next,
        ...meta,
      });
      return next;
    });

    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ subDistributor: result });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "compliance.edit", session.permissions);
    const { id } = await params;
    const meta = clientMetaFromHeaders(req.headers);

    // Soft-terminate (preserves audit trail + commission history).
    const result = await withTenant(session.tenantId, async (tx) => {
      const [existing] = await tx
        .select()
        .from(subDistributors)
        .where(eq(subDistributors.id, id));
      if (!existing) return null;
      const today = new Date().toISOString().slice(0, 10);
      const [next] = await tx
        .update(subDistributors)
        .set({
          status: "terminated",
          terminatedAt: today,
          updatedAt: new Date(),
        } as any)
        .where(eq(subDistributors.id, id))
        .returning();
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "sub_distributor.terminate",
        entityType: "sub_distributor",
        entityId: id,
        before: existing,
        after: next,
        ...meta,
      });
      return next;
    });
    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ subDistributor: result });
  } catch (err: any) {
    return handleApiError(err);
  }
}
