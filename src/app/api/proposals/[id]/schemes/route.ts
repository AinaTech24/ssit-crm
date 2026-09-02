import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/proposals/[id]/schemes
 *   Returns proposal_schemes rows for one proposal.
 *
 * PUT /api/proposals/[id]/schemes
 *   Bulk replace — the worksheet writes the whole list back in one go.
 *   Drops rows not in the payload (matched by id).
 */

import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { proposalSchemes, proposals } from "@/db/schema";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";

export const dynamic = "force-dynamic";

const SchemeRow = z.object({
  id: z.string().uuid().optional(),
  amc: z.string().max(120).nullable().optional(),
  schemeName: z.string().min(1).max(200),
  schemeCode: z.string().max(60).nullable().optional(),
  schemeCategory: z.string().max(120).nullable().optional(),
  assetClass: z.string().max(60).nullable().optional(),
  schemeRiskLevel: z
    .enum(["low", "moderate", "moderately_high", "high", "very_high"])
    .nullable()
    .optional(),
  recommendationType: z.enum(["sip", "lumpsum", "swp", "stp"]).default("sip"),
  planType: z.enum(["regular", "direct"]).nullable().optional(),
  sipAmount: z.number().nonnegative().nullable().optional(),
  lumpsumAmount: z.number().nonnegative().nullable().optional(),
  expectedReturnPct: z.number().min(-50).max(50).nullable().optional(),
  expectedHoldingYears: z.number().int().min(0).max(100).nullable().optional(),
  stepUpPct: z.number().min(0).max(100).nullable().optional(),
  goalOrObjective: z.string().max(500).nullable().optional(),
  // SWP
  corpusRequired: z.number().nonnegative().nullable().optional(),
  monthlyWithdrawal: z.number().nonnegative().nullable().optional(),
  swpPeriodMonths: z.number().int().min(0).nullable().optional(),
  // STP
  toSchemeName: z.string().max(200).nullable().optional(),
  toSchemeCode: z.string().max(60).nullable().optional(),
  monthlyTransfer: z.number().nonnegative().nullable().optional(),
  numInstallments: z.number().int().min(0).nullable().optional(),
  totalCorpusForStp: z.number().nonnegative().nullable().optional(),
});

const PutBody = z.object({
  rows: z.array(SchemeRow).max(200),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "investor.view.all", session.permissions);
    const { id } = await params;
    const result = await withTenant(session.tenantId, async (tx) => {
      const [proposal] = await tx
        .select()
        .from(proposals)
        .where(
          and(
            eq(proposals.id, id),
            eq(proposals.tenantId, session.tenantId)
          )
        )
        .limit(1);
      if (!proposal) return null;
      const rows = await tx
        .select()
        .from(proposalSchemes)
        .where(eq(proposalSchemes.proposalId, id));
      return { proposal, rows };
    });
    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "investor.edit.all", session.permissions);
    const { id } = await params;
    const parse = PutBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json(
        { error: "invalid body", issues: parse.error.issues },
        { status: 400 }
      );
    }
    const meta = clientMetaFromHeaders(req.headers);

    const updated = await withTenant(session.tenantId, async (tx) => {
      const [proposal] = await tx
        .select()
        .from(proposals)
        .where(
          and(
            eq(proposals.id, id),
            eq(proposals.tenantId, session.tenantId)
          )
        )
        .limit(1);
      if (!proposal) throw new Error("proposal not found");

      const existing = await tx
        .select()
        .from(proposalSchemes)
        .where(eq(proposalSchemes.proposalId, id));
      const existingById = new Map(existing.map((e) => [e.id, e]));
      const keepIds = new Set<string>();
      const out: any[] = [];

      for (const row of parse.data.rows) {
        const payload: any = {
          amc: row.amc ?? null,
          schemeName: row.schemeName,
          schemeCode: row.schemeCode ?? null,
          schemeCategory: row.schemeCategory ?? null,
          assetClass: row.assetClass ?? null,
          schemeRiskLevel: row.schemeRiskLevel ?? null,
          recommendationType: row.recommendationType,
          planType: row.planType ?? null,
          sipAmount: row.sipAmount != null ? String(row.sipAmount) : null,
          lumpsumAmount:
            row.lumpsumAmount != null ? String(row.lumpsumAmount) : null,
          expectedReturnPct:
            row.expectedReturnPct != null
              ? String(row.expectedReturnPct)
              : null,
          expectedHoldingYears: row.expectedHoldingYears ?? null,
          stepUpPct: row.stepUpPct != null ? String(row.stepUpPct) : null,
          goalOrObjective: row.goalOrObjective ?? null,
          corpusRequired:
            row.corpusRequired != null ? String(row.corpusRequired) : null,
          monthlyWithdrawal:
            row.monthlyWithdrawal != null
              ? String(row.monthlyWithdrawal)
              : null,
          swpPeriodMonths: row.swpPeriodMonths ?? null,
          toSchemeName: row.toSchemeName ?? null,
          toSchemeCode: row.toSchemeCode ?? null,
          monthlyTransfer:
            row.monthlyTransfer != null ? String(row.monthlyTransfer) : null,
          numInstallments: row.numInstallments ?? null,
          totalCorpusForStp:
            row.totalCorpusForStp != null
              ? String(row.totalCorpusForStp)
              : null,
          updatedAt: new Date(),
        };
        if (row.id && existingById.has(row.id)) {
          const [next] = await tx
            .update(proposalSchemes)
            .set(payload)
            .where(eq(proposalSchemes.id, row.id))
            .returning();
          out.push(next);
          keepIds.add(row.id);
        } else {
          const [created] = await tx
            .insert(proposalSchemes)
            .values({
              tenantId: session.tenantId,
              proposalId: id,
              ...payload,
            } as any)
            .returning();
          out.push(created);
          keepIds.add(created.id);
        }
      }

      // Drop rows not in the payload
      for (const e of existing) {
        if (!keepIds.has(e.id)) {
          await tx
            .delete(proposalSchemes)
            .where(eq(proposalSchemes.id, e.id));
        }
      }

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "proposal.schemes_bulk_replace",
        entityType: "proposal",
        entityId: id,
        before: { count: existing.length } as any,
        after: { count: out.length } as any,
        ...meta,
      });
      return out;
    });
    return NextResponse.json({ rows: updated });
  } catch (err: any) {
    return handleApiError(err);
  }
}
