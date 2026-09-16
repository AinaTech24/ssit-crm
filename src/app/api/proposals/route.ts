import { handleApiError } from "@/lib/api/error-handler";
/**
 * Proposals collection.
 *   GET  /api/proposals
 *   POST /api/proposals
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { dataScopeSqlFor } from "@/lib/auth/data-scope";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, can } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { autoAdvance, resolveLeadIdForInvestor } from "@/lib/blueprints/auto-advance";
import { proposals, investors, leads, families } from "@/db/schema";
import { proposalTotals } from "@/lib/proposals/projections";

export const dynamic = "force-dynamic";

/**
 * Discriminated union for product line items.
 * Mirrors the ProposalLineItem TS union in src/db/schema/proposals.ts.
 */
const LineMF = z.object({
  kind: z.literal("mf"),
  schemeName: z.string().min(1).max(200),
  amcName: z.string().max(120).optional(),
  schemeCode: z.string().max(40).optional(),
  category: z.string().max(60).optional(),
  monthlyAmount: z.number().min(0).optional(),
  lumpsum: z.number().min(0).optional(),
  sipTermYears: z.number().min(0).max(50).optional(),
  expectedReturn: z.number().min(0).max(60).optional(),
  riskRating: z.enum(["low", "moderate", "high", "very_high"]).optional(),
  projectedCorpus: z.number().min(0).optional(),
  notes: z.string().max(500).optional(),
});

const LineInsurance = z.object({
  kind: z.literal("insurance"),
  policyName: z.string().min(1).max(200),
  insurer: z.string().max(120).optional(),
  policyType: z.enum(["term", "ulip", "endowment", "health", "money_back", "other"]).optional(),
  sumAssured: z.number().min(0).optional(),
  annualPremium: z.number().min(0).optional(),
  termYears: z.number().min(0).max(99).optional(),
  riderNotes: z.string().max(300).optional(),
  notes: z.string().max(500).optional(),
});

const LinePMS = z.object({
  kind: z.literal("pms"),
  strategyName: z.string().min(1).max(200),
  manager: z.string().max(120).optional(),
  minInvestment: z.number().min(0).optional(),
  proposedAmount: z.number().min(0).optional(),
  expectedReturn: z.number().min(0).max(60).optional(),
  termYears: z.number().min(0).max(50).optional(),
  exitLoad: z.string().max(120).optional(),
  notes: z.string().max(500).optional(),
});

const LineAIF = z.object({
  kind: z.literal("aif"),
  fundName: z.string().min(1).max(200),
  manager: z.string().max(120).optional(),
  category: z.enum(["cat1", "cat2", "cat3"]).optional(),
  minInvestment: z.number().min(0).optional(),
  proposedAmount: z.number().min(0).optional(),
  lockInYears: z.number().min(0).max(20).optional(),
  targetIrr: z.number().min(0).max(60).optional(),
  notes: z.string().max(500).optional(),
});

const LineOther = z.object({
  kind: z.literal("other"),
  productName: z.string().min(1).max(200),
  company: z.string().max(120).optional(),
  amount: z.number().min(0).optional(),
  expectedReturn: z.number().min(0).max(60).optional(),
  termYears: z.number().min(0).max(99).optional(),
  remarks: z.string().max(300).optional(),
  notes: z.string().max(500).optional(),
});

const LineItem = z.discriminatedUnion("kind", [LineMF, LineInsurance, LinePMS, LineAIF, LineOther]);

/**
 * Strip null / "" / non-finite-number values from a product item so OPTIONAL
 * fields fall back to `undefined` (which the schema accepts) instead of failing.
 * Two real-world sources of these: JSON.stringify turns NaN→null (e.g. a number
 * input that received a comma-formatted "2,29,80,000" → Number(...) === NaN),
 * and empty <select>s emit "" for optional enums. Required string fields
 * (schemeName/policyName/…) are not "", so they still validate as before.
 */
function cleanProductItem(it: unknown): unknown {
  if (!it || typeof it !== "object") return it;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(it as Record<string, unknown>)) {
    if (v === null || v === "") continue;
    if (typeof v === "number" && !Number.isFinite(v)) continue;
    out[k] = v;
  }
  return out;
}
const ProductsField = z
  .preprocess((a) => (Array.isArray(a) ? a.map(cleanProductItem) : a), z.array(LineItem))
  .default([]);

const CreateBody = z
  .object({
    recipientType: z.enum(["investor", "lead", "family"]),
    investorId: z.string().uuid().optional(),
    leadId: z.string().uuid().optional(),
    familyId: z.string().uuid().optional(),
    /** Allow caller to override; otherwise we snapshot from the resolved record. */
    recipientName: z.string().max(200).optional(),
    recipientEmail: z.string().email().optional().or(z.literal("")),
    recipientPhone: z.string().max(40).optional(),

    type: z
      .enum(["comprehensive", "mutual_fund", "insurance", "pms", "aif", "mixed"])
      .default("mutual_fund"),

    title: z.string().min(2).max(200),
    summary: z.string().max(1000).optional(),
    coverLetter: z.string().max(4000).optional(),
    disclaimer: z.string().max(2000).optional(),

    products: ProductsField,
    riskRating: z
      .enum(["conservative", "moderate", "aggressive", "mixed"])
      .optional(),
    validUntil: z.string().optional(),
    attachments: z.array(z.object({ name: z.string(), url: z.string() })).optional(),
    suitabilityNote: z.string().max(2000).optional(),
    suitabilityOverrideReason: z.string().max(2000).optional(),
  })
  .refine(
    (b) =>
      (b.recipientType === "investor" && !!b.investorId) ||
      (b.recipientType === "lead" && !!b.leadId) ||
      (b.recipientType === "family" && !!b.familyId),
    {
      message:
        "investorId required for investor recipient; leadId required for lead recipient; familyId required for family recipient",
      path: ["recipientType"],
    }
  );

/** Generate the next PROP-YYYY-#### identifier for this tenant. */
async function nextProposalNumber(tx: any, tenantId: string) {
  const year = new Date().getFullYear();
  const r = await tx.execute(sql`
    SELECT COALESCE(MAX(
      CASE WHEN proposal_number ~ ('^PROP-' || ${year}::text || '-[0-9]+$')
           THEN CAST(SUBSTRING(proposal_number FROM 11) AS INTEGER)
           ELSE 0
      END
    ), 0)::int AS max_n
    FROM proposals
  `);
  const n = (r.rows[0] as any)?.max_n ?? 0;
  return `PROP-${year}-${String(n + 1).padStart(4, "0")}`;
}

export async function GET() {
  try {
    const session = await requireSession();
    requireCap(session.roles, "proposal.view", session.permissions);
    const seesAll = can(session.roles, "investor.view.all", session.permissions) || can(session.roles, "compliance.view", session.permissions);

    const rows = await withTenant(session.tenantId, async (tx) => {
      const scope = await dataScopeSqlFor(tx, session, {
        branch: "proposals.branch_id",
        owner: "proposals.prepared_by_user_id",
      });
      return tx.select().from(proposals).where(scope).orderBy(desc(proposals.createdAt));
    });
    return NextResponse.json({ proposals: rows });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "proposal.write", session.permissions);
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
      // Resolve recipient snapshot from the linked record if not provided.
      let name = body.recipientName;
      let email = body.recipientEmail || null;
      let phone = body.recipientPhone || null;
      // For family recipients we also derive an investorId pointer (the family
      // head / primary investor) so the proposal stays linked to a real client
      // for downstream queries (conversion, dashboards).
      let resolvedInvestorId = body.investorId ?? null;

      if (body.recipientType === "investor" && body.investorId) {
        const inv = (
          await tx.select().from(investors).where(eq(investors.id, body.investorId)).limit(1)
        )[0];
        if (inv) {
          name = name || inv.name;
          email = email || (inv as any).email || null;
          phone = phone || (inv as any).phone || (inv as any).mobile || null;
        }
      } else if (body.recipientType === "lead" && body.leadId) {
        const ld = (
          await tx.select().from(leads).where(eq(leads.id, body.leadId)).limit(1)
        )[0];
        if (ld) {
          name = name || ld.name;
          email = email || (ld as any).email || null;
          phone = phone || (ld as any).phone || null;
        }
      } else if (body.recipientType === "family" && body.familyId) {
        const fam = (
          await tx.select().from(families).where(eq(families.id, body.familyId)).limit(1)
        )[0];
        if (fam) {
          const headName = ((fam as any).headName as string | null) ?? "";
          // Only suffix " Family" when the head name doesn't already end with it.
          const headEndsWithFamily = /\bfamily\b\s*$/i.test(headName);
          const displayFamilyName =
            (fam as any).familyName ||
            (headName
              ? headEndsWithFamily
                ? headName
                : `${headName} Family`
              : null);
          // Resolve the family head / primary investor for contact details.
          if ((fam as any).primaryInvestorId) {
            resolvedInvestorId = (fam as any).primaryInvestorId;
            const head = (
              await tx
                .select()
                .from(investors)
                .where(eq(investors.id, (fam as any).primaryInvestorId))
                .limit(1)
            )[0];
            if (head) {
              email = email || (head as any).email || null;
              phone = phone || (head as any).phone || (head as any).mobile || null;
              // Default the name to "Mehta Family (Anil Mehta)" so the PDF is unambiguous.
              if (!name) {
                name = displayFamilyName
                  ? `${displayFamilyName} (${head.name})`
                  : head.name;
              }
            }
          }
          if (!name && displayFamilyName) name = displayFamilyName;
        }
      }
      if (!name) {
        throw Object.assign(new Error("recipient name unresolved"), { status: 400 });
      }

      const proposalNumber = await nextProposalNumber(tx, session.tenantId);
      const totals = proposalTotals(body.products);

      await tx.insert(proposals).values({
        id,
        tenantId: session.tenantId,
        branchId: session.branchId ?? null,
        proposalNumber,
        recipientType: body.recipientType,
        investorId: resolvedInvestorId,
        leadId: body.leadId ?? null,
        familyId: body.familyId ?? null,
        recipientName: name,
        recipientEmail: email,
        recipientPhone: phone,
        type: body.type,
        title: body.title,
        summary: body.summary ?? null,
        coverLetter: body.coverLetter ?? null,
        disclaimer: body.disclaimer ?? null,
        products: body.products,
        totalInvestment: totals.totalInvestment != null ? String(totals.totalInvestment) : null,
        expectedCorpus: totals.expectedCorpus != null ? String(totals.expectedCorpus) : null,
        riskRating: body.riskRating ?? null,
        status: "draft",
        validUntil: body.validUntil ? new Date(body.validUntil) : null,
        preparedByUserId: session.userId,
        preparedAt: new Date(),
        attachments: body.attachments ?? [],
        suitabilityNote: body.suitabilityNote ?? null,
        suitabilityOverrideReason: body.suitabilityOverrideReason ?? null,
      } as any);

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "proposal.create",
        entityType: "proposal",
        entityId: id,
        after: { proposalNumber, title: body.title, type: body.type, status: "draft" },
        ...clientMeta,
      });

      // ─── Smart blueprint advance — proposal drafted ───────────────
      // Push the lead's journey to `proposal_drafted`. Resolve the lead
      // id from either the direct leadId or via the investor's source
      // lead (for proposals authored against converted clients).
      const advanceLeadId =
        body.leadId ??
        (resolvedInvestorId ? await resolveLeadIdForInvestor(tx, resolvedInvestorId) : null);
      if (advanceLeadId) {
        await autoAdvance(tx, session.tenantId, advanceLeadId, "proposal.created", {
          remarks: `Auto: proposal ${proposalNumber} drafted.`,
        });
      }
    });

    return NextResponse.json({ id }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
