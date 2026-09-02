import { handleApiError } from "@/lib/api/error-handler";
/**
 * Insurance claims collection.
 *   POST /api/insurance-claims — create a claim
 * (The list page queries directly via withTenant; no GET needed here.)
 */
import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { eq, and, inArray, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, can } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { insuranceClaims, insurancePolicies, investors, CLAIM_STATUSES, CLAIM_TYPES, CLAIM_MODES, INTIMATION_MODES, SUBMITTED_MODES } from "@/db/schema";
import { policyStatusForClaim } from "@/lib/insurance/claim-status";

export const dynamic = "force-dynamic";

const ClaimBody = z.object({
  policyId: z.string().uuid().optional(),
  policyNumber: z.string().max(80).optional(),
  insurer: z.string().max(160).optional(),
  investorId: z.string().uuid().optional(),
  proposerName: z.string().min(1).max(160),
  contactPerson: z.string().max(160).optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().max(20).optional(),
  claimStatus: z.enum(CLAIM_STATUSES).optional(),
  policyDetails: z.string().max(2000).optional(),
  claimType: z.enum(CLAIM_TYPES).optional(),
  claimMode: z.enum(CLAIM_MODES).optional(),
  intimationMode: z.enum(INTIMATION_MODES).optional(),
  submittedMode: z.enum(SUBMITTED_MODES).optional(),
  admissionDate: z.string().optional(),
  intimationDate: z.string().optional(),
  submissionDate: z.string().optional(),
  settlementDate: z.string().optional(),
  claimedAmount: z.number().min(0).optional(),
  settledAmount: z.number().min(0).optional(),
  rmId: z.string().uuid().optional(),
  comments: z.string().max(2000).optional(),
  documents: z.array(z.object({
    name: z.string().max(200),
    docType: z.string().max(60).optional(),
    key: z.string().max(400).optional(),
    url: z.string().max(800).optional(),
    mime: z.string().max(120).optional(),
    size: z.number().optional(),
    uploadedAt: z.string().optional(),
  })).max(50).optional(),
});

export async function GET() {
  try {
    const session = await requireSession();
    requireCap(session.roles, "insurance.view", session.permissions);
    // Claims carry proposer PII + settled amounts. Managers see all; everyone
    // else only claims for a client they manage OR that they own (rmId).
    const seesAll =
      can(session.roles, "investor.view.all", session.permissions) ||
      can(session.roles, "compliance.view", session.permissions);
    const scope = seesAll
      ? undefined
      : sql`(${insuranceClaims.rmId} = ${session.userId}::uuid OR ${insuranceClaims.investorId} IN (SELECT id FROM investors WHERE rm_id = ${session.userId}::uuid))`;
    const rows = await withTenant(session.tenantId, async (tx) =>
      tx
        .select({
          id: insuranceClaims.id,
          investorId: insuranceClaims.investorId,
          proposerName: insuranceClaims.proposerName,
          insurer: insuranceClaims.insurer,
          policyNumber: insuranceClaims.policyNumber,
          claimStatus: insuranceClaims.claimStatus,
          claimType: insuranceClaims.claimType,
          claimMode: insuranceClaims.claimMode,
          claimedAmount: insuranceClaims.claimedAmount,
          settledAmount: insuranceClaims.settledAmount,
          intimationDate: insuranceClaims.intimationDate,
          submissionDate: insuranceClaims.submissionDate,
          settlementDate: insuranceClaims.settlementDate,
          createdAt: insuranceClaims.createdAt,
          investorName: investors.name,
        })
        .from(insuranceClaims)
        .leftJoin(investors, eq(insuranceClaims.investorId, investors.id))
        .where(scope)
        .orderBy(desc(insuranceClaims.createdAt))
        .limit(500)
    );
    return NextResponse.json({ claims: rows });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "insurance.write", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = ClaimBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const b = parse.data;
    const id = uuid();
    const clientMeta = clientMetaFromHeaders(req.headers);

    await withTenant(session.tenantId, async (tx) => {
      if (b.investorId) {
        const inv = await tx.select({ id: investors.id }).from(investors).where(eq(investors.id, b.investorId)).limit(1);
        if (inv.length === 0) throw Object.assign(new Error("Client not found in this tenant"), { status: 404 });
      }
      await tx.insert(insuranceClaims).values({
        id,
        tenantId: session.tenantId,
        branchId: session.branchId ?? null,
        policyId: b.policyId ?? null,
        policyNumber: b.policyNumber ?? null,
        insurer: b.insurer ?? null,
        investorId: b.investorId ?? null,
        proposerName: b.proposerName,
        contactPerson: b.contactPerson ?? null,
        email: b.email || null,
        phone: b.phone ?? null,
        claimStatus: b.claimStatus ?? "claim_intimated",
        policyDetails: b.policyDetails ?? null,
        claimType: b.claimType ?? null,
        claimMode: b.claimMode ?? null,
        intimationMode: b.intimationMode ?? null,
        submittedMode: b.submittedMode ?? null,
        admissionDate: b.admissionDate ?? null,
        intimationDate: b.intimationDate ?? null,
        submissionDate: b.submissionDate ?? null,
        settlementDate: b.settlementDate ?? null,
        claimedAmount: b.claimedAmount != null ? String(b.claimedAmount) : "0",
        settledAmount: b.settledAmount != null ? String(b.settledAmount) : "0",
        rmId: b.rmId ?? session.userId,
        comments: b.comments ?? null,
        documents: b.documents ?? [],
      } as any);

      // #5 Reconcile the linked policy's status with the new claim's status.
      if (b.policyId) {
        const next = policyStatusForClaim(b.claimStatus ?? "claim_intimated");
        if (next) {
          await tx.update(insurancePolicies)
            .set({ status: next, updatedAt: new Date() } as any)
            .where(and(
              eq(insurancePolicies.id, b.policyId),
              eq(insurancePolicies.tenantId, session.tenantId),
              inArray(insurancePolicies.status, ["active", "claim_filed", "claim_settled"]),
            ));
        }
      }

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "insurance_claim.create",
        entityType: "insurance_claim",
        entityId: id,
        after: { proposerName: b.proposerName, policyNumber: b.policyNumber, claimStatus: b.claimStatus, claimedAmount: b.claimedAmount },
        ...clientMeta,
      });
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
