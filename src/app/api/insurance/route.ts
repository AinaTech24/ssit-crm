import { handleApiError } from "@/lib/api/error-handler";
/**
 * Insurance policies collection.
 *   GET  /api/insurance
 *   POST /api/insurance
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, can } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import {
  insurancePolicies,
  investors,
  POLICY_TYPES,
  POLICY_STATUSES,
  PREMIUM_FREQUENCIES,
} from "@/db/schema";

export const dynamic = "force-dynamic";

const CreateBody = z.object({
  investorId: z.string().uuid(),
  sourceProposalId: z.string().uuid().optional(),
  policyNumber: z.string().max(60).optional(),
  insurer: z.string().min(1).max(120),
  planName: z.string().min(1).max(200),
  policyType: z.enum(POLICY_TYPES),
  livesCovered: z.number().int().min(1).max(20).optional(),
  sumAssured: z.number().min(0).optional(),
  annualPremium: z.number().min(0).optional(),
  /** Advisor commission for this policy (rupees; 1-time or trail). */
  commissionPaisa: z.number().min(0).optional(),
  premiumFrequency: z.enum(PREMIUM_FREQUENCIES).default("annual"),
  premiumPayingTermYears: z.number().int().min(0).max(99).optional(),
  policyTermYears: z.number().int().min(0).max(99).optional(),
  policyStartDate: z.string().optional(),
  riskCoverStartDate: z.string().optional(),
  maturityDate: z.string().optional(),
  lastPremiumDate: z.string().optional(),
  nextPremiumDueDate: z.string().optional(),
  gracePeriodDays: z.number().int().min(0).max(180).optional(),
  nomineeName: z.string().max(120).optional(),
  nomineeRelation: z.string().max(40).optional(),
  nomineeDob: z.string().optional(),
  nomineeShare: z.number().int().min(0).max(100).optional(),
  riders: z
    .array(
      z.object({
        name: z.string(),
        sumAssured: z.number().optional(),
        premium: z.number().optional(),
      })
    )
    .optional(),
  documents: z
    .array(z.object({ name: z.string(), url: z.string() }))
    .optional(),
  remarks: z.string().max(1000).optional(),
  status: z.enum(POLICY_STATUSES).optional(),
  soldByUserId: z.string().uuid().optional(),
  /** Category-specific extras (motor/health/general) + businessType + proposer
   *  when different from holder. Free-form JSON, capped to keep payloads sane. */
  details: z.record(z.any()).optional(),
});

export async function GET() {
  try {
    const session = await requireSession();
    requireCap(session.roles, "insurance.view", session.permissions);
    // Policies carry nominee PII + commission. Managers see all; everyone else
    // only their own book — policies for a client they manage OR that they sold
    // (insurance.view alone otherwise exposes every advisor's commission).
    const seesAll = can(session.roles, "investor.view.all", session.permissions) || can(session.roles, "compliance.view", session.permissions);
    const scope = seesAll
      ? undefined
      : sql`(${insurancePolicies.soldByUserId} = ${session.userId}::uuid OR ${insurancePolicies.investorId} IN (SELECT id FROM investors WHERE rm_id = ${session.userId}::uuid))`;
    const rows = await withTenant(session.tenantId, async (tx) =>
      tx.select().from(insurancePolicies).where(scope).orderBy(desc(insurancePolicies.createdAt)).limit(500)
    );
    return NextResponse.json({ policies: rows });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "insurance.write", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = CreateBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json(
        { error: "invalid body", issues: parse.error.issues },
        { status: 400 }
      );
    }
    const body = parse.data;
    const id = uuid();
    const clientMeta = clientMetaFromHeaders(req.headers);

    await withTenant(session.tenantId, async (tx) => {
      const clientExists = await tx
        .select({ id: investors.id })
        .from(investors)
        .where(eq(investors.id, body.investorId))
        .limit(1);
      if (clientExists.length === 0) {
        throw Object.assign(new Error("Client investor not found in this tenant context"), { status: 404 });
      }

      await tx.insert(insurancePolicies).values({
        id,
        tenantId: session.tenantId,
        branchId: session.branchId ?? null,
        investorId: body.investorId,
        sourceProposalId: body.sourceProposalId ?? null,
        policyNumber: body.policyNumber ?? null,
        insurer: body.insurer,
        planName: body.planName,
        policyType: body.policyType,
        livesCovered: body.livesCovered ?? 1,
        sumAssured: body.sumAssured != null ? String(body.sumAssured) : null,
        annualPremium: body.annualPremium != null ? String(body.annualPremium) : null,
        commissionPaisa: body.commissionPaisa != null ? String(body.commissionPaisa) : null,
        premiumFrequency: body.premiumFrequency,
        premiumPayingTermYears: body.premiumPayingTermYears ?? null,
        policyTermYears: body.policyTermYears ?? null,
        policyStartDate: body.policyStartDate ?? null,
        riskCoverStartDate: body.riskCoverStartDate ?? null,
        maturityDate: body.maturityDate ?? null,
        lastPremiumDate: body.lastPremiumDate ?? null,
        nextPremiumDueDate: body.nextPremiumDueDate ?? null,
        gracePeriodDays: body.gracePeriodDays ?? 30,
        nomineeName: body.nomineeName ?? null,
        nomineeRelation: body.nomineeRelation ?? null,
        nomineeDob: body.nomineeDob ?? null,
        nomineeShare: body.nomineeShare ?? 100,
        riders: body.riders ?? [],
        documents: body.documents ?? [],
        details: body.details ?? {},
        remarks: body.remarks ?? null,
        status: body.status ?? "active",
        soldByUserId: body.soldByUserId ?? session.userId,
        soldAt: new Date(),
      } as any);

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "insurance.create",
        entityType: "insurance_policy",
        entityId: id,
        after: {
          insurer: body.insurer,
          planName: body.planName,
          policyType: body.policyType,
          sumAssured: body.sumAssured,
        },
        ...clientMeta,
      });
    });

    return NextResponse.json({ id }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
