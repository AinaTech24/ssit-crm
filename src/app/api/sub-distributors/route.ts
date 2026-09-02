import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET  /api/sub-distributors  — list (optionally filtered by status / q)
 * POST /api/sub-distributors  — create one
 *
 * Owner / compliance gated. Sub-distributors are SEBI-relevant data —
 * not the kind of record an RM should mass-create.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq, and, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { subDistributors } from "@/db/schema";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";

export const dynamic = "force-dynamic";

const PostBody = z.object({
  name: z.string().min(1).max(160),
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
    .default("individual"),
  city: z.string().max(80).nullable().optional(),
  email: z.string().email().nullable().optional().or(z.literal("")),
  mobile: z.string().max(40).nullable().optional(),
  panNumber: z
    .string()
    .regex(/^[A-Z]{5}\d{4}[A-Z]$/i, "PAN format: ABCDE1234F")
    .nullable()
    .optional()
    .or(z.literal("")),
  // Licensing
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
  // Commission + payout
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
  status: z.enum(["active", "inactive", "terminated"]).default("active"),
  onboardedAt: z.string().nullable().optional(),
  remarks: z.string().max(4000).nullable().optional(),
  dscOnFile: z.boolean().optional(),
  relationshipManagerId: z.string().uuid().nullable().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "compliance.edit", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);

    const sp = req.nextUrl.searchParams;
    const status = sp.get("status");
    const q = (sp.get("q") ?? "").trim();

    const rows = await withTenant(session.tenantId, async (tx) => {
      const where = [eq(subDistributors.tenantId, session.tenantId)];
      if (status) where.push(eq(subDistributors.status, status as any));
      if (q) {
        where.push(
          or(
            ilike(subDistributors.name, `%${q}%`),
            ilike(subDistributors.code, `%${q}%`),
            ilike(subDistributors.arnNumber, `%${q}%`),
            ilike(subDistributors.email, `%${q}%`),
            ilike(subDistributors.mobile, `%${q}%`)
          )!
        );
      }
      return tx
        .select()
        .from(subDistributors)
        .where(and(...where))
        .orderBy(subDistributors.name);
    });

    return NextResponse.json({ subDistributors: rows });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "compliance.edit", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);

    const parse = PostBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json(
        { error: "invalid body", issues: parse.error.issues },
        { status: 400 }
      );
    }
    const meta = clientMetaFromHeaders(req.headers);
    const data = parse.data;

    try {
      const row = await withTenant(session.tenantId, async (tx) => {
        const [r] = await tx
          .insert(subDistributors)
          .values({
            tenantId: session.tenantId,
            name: data.name,
            code: data.code || null,
            typeOfAssociation: data.typeOfAssociation,
            city: data.city || null,
            email: data.email || null,
            mobile: data.mobile || null,
            panNumber: data.panNumber ? data.panNumber.toUpperCase() : null,
            nismCertificateNo: data.nismCertificateNo || null,
            nismExamDate: data.nismExamDate || null,
            nismExpiryAt: data.nismExpiryAt || null,
            nismCategory: data.nismCategory || null,
            arnNumber: data.arnNumber || null,
            arnRegistrationDate: data.arnRegistrationDate || null,
            arnExpiryAt: data.arnExpiryAt || null,
            euin: data.euin || null,
            euinExpiryAt: data.euinExpiryAt || null,
            commissionSplitPct:
              data.commissionSplitPct != null
                ? String(data.commissionSplitPct)
                : null,
            bankDetails: data.bankDetails ?? null,
            status: data.status,
            onboardedAt: data.onboardedAt || null,
            remarks: data.remarks || null,
            dscOnFile: data.dscOnFile ?? false,
            relationshipManagerId: data.relationshipManagerId ?? null,
            createdBy: session.userId,
          } as any)
          .returning();

        await recordAudit(tx, {
          tenantId: session.tenantId,
          actorUserId: session.userId,
          action: "sub_distributor.create",
          entityType: "sub_distributor",
          entityId: r.id,
          before: null,
          after: r,
          ...meta,
        });
        return r;
      });
      return NextResponse.json({ subDistributor: row });
    } catch (err: any) {
      const msg = String(err?.message ?? "");
      if (msg.includes("sub_distributors_tenant_code_unique")) {
        return NextResponse.json(
          { error: "That code is already in use. Pick another." },
          { status: 409 }
        );
      }
      throw err;
    }
  } catch (err: any) {
    return handleApiError(err);
  }
}

// Touch sql to suppress unused-import warning during dev hot reload.
void sql;
