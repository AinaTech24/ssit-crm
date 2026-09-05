import { handleApiError } from "@/lib/api/error-handler";
/**
 * Investors collection.
 *
 *   GET  /api/investors?q=&segment=&page=&limit=  — list with search + filter
 *   POST /api/investors                            — create new investor
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, requireAny, can } from "@/lib/auth/rbac";
import { assertActiveLicense, assertModuleEnabled } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { buildInvestorConditions } from "@/lib/investors/list-filters";
import { investorScopeCondition } from "@/lib/investors/access";
import { healthFields } from "@/lib/investors/health";
import { NomineesArray } from "@/lib/investors/nominee";
import { ReferralsArray } from "@/lib/investors/referral";
import { registerNomineePanDocs } from "@/lib/investors/nominee-docs";
import { loadCustomFieldDefs, sanitizeCustomFields } from "@/lib/custom-fields/values";
import { applyRiskCategory, RISK_CATEGORIES } from "@/lib/risk-profile/apply";
import { cleanUccCodes } from "@/lib/investors/ucc";
import { investors, eventsOutbox } from "@/db/schema";

export const dynamic = "force-dynamic";

const CreateBody = z.object({
  name: z.string().min(2).max(200),
  pan: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "invalid PAN"),
  nominees: NomineesArray,
  referrals: ReferralsArray,
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  alternatePhone: z.string().optional(),
  whatsappPhone: z.string().optional(),
  dob: z.string().optional(),
  gender: z.enum(["M", "F", "O"]).optional(),
  occupation: z.string().optional(),
  incomeRange: z.string().optional(),
  segmentTag: z.enum(["HNI", "Affluent", "Retail", "NRI", "Corporate"]).optional(),
  investorCategory: z
    .enum(["individual", "huf", "corporate", "company", "trust", "nri", "minor", "other"])
    .default("individual"),
  rmId: z.string().uuid().optional(),
  familyId: z.string().uuid().optional(),
  bseUccCode: z.string().optional(),
  nseCanCode: z.string().optional(),
  uccCodes: z.array(z.string()).optional(),
  mandateStatus: z
    .enum(["none", "pending", "active", "expired", "rejected", "cancelled"])
    .optional(),
  mandateRefNo: z.string().optional(),
  status: z
    .enum(["active", "dormant", "inactive", "redemption_risk", "closed"])
    .default("active"),
  notes: z.string().optional(),
  address: z
    .object({
      line1: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      pincode: z.string().optional(),
      country: z.string().optional(),
    })
    .optional(),

  // ── Extended client-master fields (Batch 2) — all optional. ──
  employerName: z.string().optional(), // Company Name
  aadhaarLast4: z.string().max(4).optional(),
  clientCategory: z.enum(["A", "B", "C", "D"]).optional(),
  kycStatus: z
    .enum(["pending", "registered", "verified", "hold", "rejected", "expired", "re_kyc_required"])
    .optional(),
  taxStatus: z.string().optional(),
  residencyStatus: z.enum(["indian_resident", "nri", "oci", "pio", "foreign_national"]).optional(),
  maritalStatus: z.string().optional(),
  modeOfHolding: z.string().optional(),
  anniversaryDate: z.string().optional(),
  birthPlace: z.string().optional(),
  motherName: z.string().optional(),
  mobileRelation: z.string().optional(),
  emailRelation: z.string().optional(),
  referralClientName: z.string().optional(),
  familyOwnerName: z.string().optional(),
  householdType: z.string().optional(), // "Family or Individual"
  onboardedAt: z.string().optional(), // Date of Onboarding
  lastReviewAt: z.string().optional(), // Last Meeting Date
  nextReviewAt: z.string().optional(), // Next Meeting Date
  reviewFrequency: z.enum(["monthly", "quarterly", "half_yearly", "annual"]).optional(),
  // Second / joint holder.
  secondHolderFirstName: z.string().optional(),
  secondHolderLastName: z.string().optional(),
  secondHolderOccupation: z.string().optional(),
  secondHolderCompanyName: z.string().optional(),
  secondHolderBirthPlace: z.string().optional(),
  secondHolderMotherName: z.string().optional(),
  secondHolderMaritalStatus: z.string().optional(),
  /** MFD-defined custom fields — sanitized against the firm's definitions. */
  customFields: z.record(z.string(), z.any()).optional(),
  /** Risk-profile category — auto-creates a risk_profile_responses record. */
  riskProfile: z.enum(RISK_CATEGORIES).optional(),
});

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    // Plan gate: a tenant whose package excludes the client module can't reach
    // the data by hitting the API directly (the sidebar already hides it).
    await assertModuleEnabled(session.tenantId, "client_master", session.roles);
    // Block roles with no investor visibility (e.g. marketing per spec § 3)
    const seesAll = can(session.roles, "investor.view.all", session.permissions);
    const seesAssigned = can(session.roles, "investor.view.assigned", session.permissions);
    if (!seesAll && !seesAssigned) {
      return NextResponse.json({ error: "forbidden: missing investor.view" }, { status: 403 });
    }

    const url = new URL(req.url);
    // Full web-parity filter set (q, segment, category, tier, status, kyc, rm,
    // gaps, quick-filters, created date range) via the SAME builder the web list
    // + Excel export use, so mobile and web return identical rows.
    const sp: Record<string, string | undefined> = {};
    url.searchParams.forEach((v, k) => {
      sp[k] = v;
    });
    const page = Math.max(0, Number(url.searchParams.get("page") ?? "0"));
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? "50")));
    const offset = page * limit;

    // Sort — mirrors InvestorSortSelect (aum / created / name / sip / health / review).
    const SORT_COLS: Record<string, any> = {
      aum: investors.aum,
      created: investors.createdAt,
      name: investors.name,
      sip: investors.activeSipAmount,
      health: investors.healthScore,
      review: investors.nextReviewAt,
    };
    const sortCol = SORT_COLS[url.searchParams.get("sort") ?? "created"] ?? investors.createdAt;
    const dir = url.searchParams.get("dir") === "asc" ? asc : desc;

    const result = await withTenant(
      session.tenantId,
      async (tx) => {
        const conditions: any[] = buildInvestorConditions(sp, session.userId);
        // Never list records merged into another client (the retired duplicate).
        conditions.push(isNull(investors.mergedIntoId));
        // Scope: branch heads → their whole branch; assigned-only RMs → their
        // book. Shared with the list page and the Excel export so all three
        // return the same rows.
        const scope = await investorScopeCondition(tx, session);
        if (scope) conditions.push(scope);
        const where = and(...conditions);
        const rows = await tx
          .select()
          .from(investors)
          .where(where as any)
          .orderBy(dir(sortCol))
          .limit(limit)
          .offset(offset);

        const countRes = await tx
          .select({ c: sql<number>`count(*)::int` })
          .from(investors)
          .where(where as any);

        return { rows, total: Number(countRes[0]?.c ?? 0), page, limit };
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    // An RM creates clients into their OWN book — requiring investor.edit.all
    // (back_office / ops only) blocked every RM and team member from adding a
    // client at all. Assigned-only callers are pinned to themselves below.
    requireAny(session.roles, ["investor.edit.all", "investor.edit.assigned"], session.permissions);
    const canAssignAnyRm = can(session.roles, "investor.edit.all", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);

    const parse = CreateBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const body = parse.data;

    const id = uuid();
    const clientMeta = clientMetaFromHeaders(req.headers);
    await withTenant(session.tenantId, async (tx) => {
      // Sanitize firm custom fields against their definitions before storing.
      const cfDefs = await loadCustomFieldDefs(tx, session.tenantId, "investor");
      const customFields = sanitizeCustomFields(cfDefs, body.customFields);

      const inserted = await tx
        .insert(investors)
        .values({
          id,
          tenantId: session.tenantId,
          branchId: session.branchId,
          name: body.name,
          pan: body.pan,
          email: body.email || null,
          phone: body.phone || null,
          whatsappPhone: body.whatsappPhone || null,
          dob: body.dob || null,
          gender: body.gender ?? null,
          occupation: body.occupation || null,
          employerName: body.employerName || null,
          segmentTag: body.segmentTag,
          investorCategory: body.investorCategory,
          clientCategory: body.clientCategory ?? null,
          // Nominees — store the array + mirror the first into legacy columns.
          nominees: body.nominees ?? [],
          referrals: body.referrals ?? [],
          nomineeName: body.nominees?.[0]?.name || null,
          nomineeRelation: body.nominees?.[0]?.relation || null,
          nomineeDob: body.nominees?.[0]?.dob || null,
          // Assigned-only callers may only create into their own book, so a
        // supplied rmId is ignored for them.
        rmId: (canAssignAnyRm ? body.rmId : undefined) ?? session.userId,
          familyId: body.familyId ?? null,
          address: body.address,
          notes: body.notes,
          bseUccCode: body.bseUccCode || null,
          nseCanCode: body.nseCanCode || null,
          uccCodes: cleanUccCodes(body.uccCodes),
          // KYC / compliance
          kycStatus: body.kycStatus ?? "pending",
          taxStatus: body.taxStatus || null,
          residencyStatus: body.residencyStatus ?? null,
          aadhaarLast4: body.aadhaarLast4 || null,
          // Personal
          maritalStatus: body.maritalStatus || null,
          modeOfHolding: body.modeOfHolding || null,
          anniversaryDate: body.anniversaryDate || null,
          birthPlace: body.birthPlace || null,
          motherName: body.motherName || null,
          mobileRelation: body.mobileRelation || null,
          emailRelation: body.emailRelation || null,
          referralClientName: body.referralClientName || null,
          familyOwnerName: body.familyOwnerName || null,
          householdType: body.householdType || null,
          // Second / joint holder
          secondHolderFirstName: body.secondHolderFirstName || null,
          secondHolderLastName: body.secondHolderLastName || null,
          secondHolderOccupation: body.secondHolderOccupation || null,
          secondHolderCompanyName: body.secondHolderCompanyName || null,
          secondHolderBirthPlace: body.secondHolderBirthPlace || null,
          secondHolderMotherName: body.secondHolderMotherName || null,
          secondHolderMaritalStatus: body.secondHolderMaritalStatus || null,
          // Relationship / review
          reviewFrequency: body.reviewFrequency ?? null,
          lastReviewAt: body.lastReviewAt ? new Date(body.lastReviewAt) : null,
          nextReviewAt: body.nextReviewAt ? new Date(body.nextReviewAt) : null,
          onboardedAt: body.onboardedAt ? new Date(body.onboardedAt) : new Date(),
          customFields: Object.keys(customFields).length ? customFields : null,
          status: "active",
          // Deterministic initial health from the captured fields.
          ...healthFields({
            status: "active",
            kycStatus: "pending",
            riskProfile: null,
            riskProfileSignedAt: null,
          }),
        } as any)
        .returning();

      // Emit outbox event so subscribed workflows can react
      await tx.insert(eventsOutbox).values({
        tenantId: session.tenantId,
        kind: "investor.created",
        entityType: "investor",
        entityId: id,
        after: inserted[0] as any,
        meta: { userId: session.userId } as any,
      } as any);

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "investor.create",
        entityType: "investor",
        entityId: id,
        after: { name: body.name, pan: body.pan, segmentTag: body.segmentTag },
        ...clientMeta,
      });

      // Register each nominee's PAN file as a client document.
      await registerNomineePanDocs(tx, session.tenantId, id, body.nominees, session.userId);

      // Risk profile chosen on the form → create a risk_profile_responses record
      // + cache it on the investor row (no-op if not provided).
      if (body.riskProfile) {
        await applyRiskCategory({
          tx,
          tenantId: session.tenantId,
          investorId: id,
          category: body.riskProfile,
          currentCategory: null,
          createdById: session.userId,
          signedByName: body.name,
        });
      }
    });

    return NextResponse.json({ id }, { status: 201 });
  } catch (err: any) {
    if (String(err?.message ?? "").includes("investors_tenant_pan_unique")) {
      return NextResponse.json({ error: "investor with this PAN already exists" }, { status: 409 });
    }
    return handleApiError(err);
  }
}
