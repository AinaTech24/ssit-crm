import { handleApiError } from "@/lib/api/error-handler";
/**
 * Single investor endpoints.
 *
 *   GET    /api/investors/[id]   — full investor + folios + sips + last comms
 *   PATCH  /api/investors/[id]   — partial update (catalog-writable fields only)
 *   DELETE /api/investors/[id]   — PERMANENT hard delete: removes the client and
 *                                  cascades its owned-data subgraph (folios,
 *                                  transactions, SIPs, goals, proposals … per
 *                                  migration 0131). Irreversible. Gated on the
 *                                  narrow `investor.delete` capability (owner /
 *                                  compliance only) — NOT `investor.edit.all`.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, requireAny } from "@/lib/auth/rbac";
import { assertInScope } from "@/lib/auth/data-scope";
import { cleanUccCodes } from "@/lib/investors/ucc";
import { normaliseTags } from "@/lib/investors/client-tags";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { healthFields } from "@/lib/investors/health";
import { computeNextReview } from "@/lib/investors/review-cadence";
import { NomineesArray } from "@/lib/investors/nominee";
import { ReferralsArray } from "@/lib/investors/referral";
import { registerNomineePanDocs } from "@/lib/investors/nominee-docs";
import { recomputeFamilyHealthForInvestor } from "@/lib/families/health-persist";
import { propagateFamilyReview } from "@/lib/investors/family-review";
import { autoAdvance, resolveLeadIdForInvestor } from "@/lib/blueprints/auto-advance";
import {
  investors,
  folios,
  sips,
  goals,
  communications,
  serviceRequests,
  tasks,
  eventsOutbox,
  auditLog,
  complianceDocuments,
  users,
  // Tables that reference the client by a plain uuid (NO foreign key), so the
  // migration-0131 FK cascade never reaches them — cleaned up explicitly on purge.
  reviewMeetings,
  sipRejections,
  onboardingPipelines,
  riskProfileResponses,
  activities,
  shareTokens,
  financialDiscoveries,
  leads,
  families,
} from "@/db/schema";

export const dynamic = "force-dynamic";

/** Client-phase stages BEFORE "UCC Activated" — see the KYC route's identical
 *  PRE_KYC_STAGES for why this guard exists (forward-only advance). */
const PRE_UCC_STAGES = new Set([
  "kyc_validated", "kyc_registered", "kyc_pending", "modify_kyc", "physical_kyc", "online_kyc",
  "ucc_create",
]);
/** Client-phase stages BEFORE "Mandate Activated". */
const PRE_MANDATE_STAGES = new Set([
  "kyc_validated", "kyc_registered", "kyc_pending", "modify_kyc", "physical_kyc", "online_kyc",
  "ucc_create", "ucc_activated", "mandate_create",
]);

const Patch = z.object({
  /** Optimistic concurrency token — the updatedAt the client loaded. If the row
   *  has changed since, the save is rejected (409) so two RMs don't silently
   *  clobber each other. Optional: callers that don't send it skip the check. */
  expectedUpdatedAt: z.string().optional(),
  name: z.string().optional(),
  // Master identity — editable so RMs can fix typos. PAN is uppercased + length-
  // capped; empty string clears it. (DOB is below.)
  pan: z.string().max(10).nullable().optional().or(z.literal("")),
  email: z.string().email().optional().or(z.literal("")),
  // Nullable: the edit modal sends `null` to CLEAR a phone (it builds
  // `f.phone || null`), and a client with no number on file round-trips the
  // same way. Declared non-nullable these rejected the whole payload with a
  // bare "invalid body" — the save failed with nothing pointing at the field.
  phone: z.string().nullable().optional(),
  whatsappPhone: z.string().nullable().optional(),
  // Client photo — storage key (general kind) or external URL; "" clears it.
  avatarUrl: z.string().max(500).nullable().optional(),
  segmentTag: z.enum(["HNI", "Affluent", "Retail", "NRI", "Corporate"]).optional(),
  investorCategory: z.enum(["individual", "huf", "corporate", "company", "trust", "nri", "minor", "other"]).optional(),
  rmId: z.string().uuid().optional(),
  serviceRmId: z.string().uuid().nullable().optional(),
  // Client-service preferences
  statementCadence: z.enum(["off", "monthly", "quarterly"]).optional(),
  languagePref: z.enum(["en", "hi", "gu", "mr", "ta", "te", "kn", "bn", "ml", "pa"]).optional(),
  riskProfile: z.enum(["conservative", "moderate", "aggressive", "very_aggressive"]).optional(),
  nomineeName: z.string().optional(),
  nomineeRelation: z.string().optional(),
  bankName: z.string().optional(),
  bankAccountNumberMasked: z.string().optional(),
  bankIfsc: z.string().optional(),
  // Multiple nominees / bank accounts. The legacy single columns above are kept
  // in sync with the first array entry (mirrored in the handler).
  nominees: NomineesArray,
  referrals: ReferralsArray,
  bankAccounts: z.array(z.object({
    bankName: z.string().max(120),
    accountMasked: z.string().max(60).optional(),
    ifsc: z.string().max(20).optional(),
    accountType: z.string().max(20).optional(),
  })).max(10).optional(),
  notes: z.string().optional(),
  // KYC tracker (Network FP 2.4 parity, migration 0024)
  nameAsPerPan: z.string().max(200).nullable().optional(),
  kycStatus: z
    .enum([
      "pending",
      "registered",
      "verified",
      "hold",
      "rejected",
      "expired",
      "re_kyc_required",
    ])
    .optional(),
  panAadhaarLinkStatus: z
    .enum(["linked", "not_linked", "pending", "not_applicable"])
    .nullable()
    .optional(),
  residencyStatus: z
    .enum(["indian_resident", "nri", "oci", "pio", "foreign_national"])
    .nullable()
    .optional(),
  aadhaarLast4: z
    .string()
    .regex(/^\d{4}$/, "Aadhaar last 4 must be 4 digits")
    .nullable()
    .optional()
    .or(z.literal("")),
  kycValidatedAt: z.string().nullable().optional(),
  ckycNumber: z.string().max(40).nullable().optional(),
  ckycExpiryAt: z.string().nullable().optional(),
  /** Cross-sell / product-holdings matrix: { productKey: statusKey }. */
  crossSell: z.record(z.string(), z.string()).nullable().optional(),
  // ── Master-record editable fields (Sanchay parity) ──────────────────
  dob: z.string().nullable().optional(), // YYYY-MM-DD (date column accepts string)
  gender: z.enum(["M", "F", "O"]).nullable().optional(),
  alternatePhone: z.string().max(20).nullable().optional(),
  occupation: z.string().max(120).nullable().optional(),
  incomeRange: z.string().max(60).nullable().optional(),
  employerName: z.string().max(200).nullable().optional(),
  address: z
    .object({
      line1: z.string().max(300).optional(),
      city: z.string().max(120).optional(),
      state: z.string().max(120).optional(),
      pincode: z.string().max(12).optional(),
      country: z.string().max(80).optional(),
    })
    .nullable()
    .optional(),
  serviceTier: z.enum(["A", "B", "C"]).nullable().optional(),
  clientCategory: z.enum(["A", "B", "C", "D"]).nullable().optional(),
  bseUccCode: z.string().max(40).nullable().optional(),
  nseCanCode: z.string().max(40).nullable().optional(),
  uccCodes: z.array(z.string()).nullable().optional(),
  mfCode: z.string().max(60).nullable().optional(),
  moCode: z.string().max(60).nullable().optional(),
  bajajCode: z.string().max(60).nullable().optional(),
  lasCode: z.string().max(60).nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
  mandateStatus: z.enum(["none", "pending", "active", "expired", "rejected", "cancelled"]).nullable().optional(),
  mandateRefNo: z.string().max(60).nullable().optional(),
  status: z.enum(["active", "dormant", "inactive", "redemption_risk", "closed", "exited"]).optional(),
  reviewFrequency: z.enum(["monthly", "quarterly", "half_yearly", "annual"]).nullable().optional(),
  // Explicit review dates. The cadence preset auto-derives nextReviewAt, but an
  // RM must be able to record when a review ACTUALLY happened (and override the
  // next one) — a real review rarely lands exactly on the computed date.
  // An explicit value always wins over the auto-computation below.
  lastReviewAt: z.string().nullable().optional(),
  nextReviewAt: z.string().nullable().optional(),
  // Custom review cadence in days (overrides the preset above). 1–3650 days.
  reviewFrequencyDays: z.number().int().min(1).max(3650).nullable().optional(),
  // Relationship dates — onboardedAt is a timestamp (coerced to Date in the
  // handler); anniversaryDate is a plain date column (accepts YYYY-MM-DD).
  onboardedAt: z.string().nullable().optional(),
  anniversaryDate: z.string().nullable().optional(),
  // ── Fields the client-details card shows but the edit modal couldn't reach.
  //    Free-text (not enums) where RTA imports supply arbitrary values, so an
  //    imported record round-trips through the editor without being mangled.
  maritalStatus: z.string().max(40).nullable().optional(),
  motherName: z.string().max(200).nullable().optional(),
  birthPlace: z.string().max(120).nullable().optional(),
  mobileRelation: z.string().max(40).nullable().optional(),
  emailRelation: z.string().max(40).nullable().optional(),
  modeOfHolding: z.string().max(40).nullable().optional(),
  householdType: z.string().max(40).nullable().optional(),
  taxStatus: z.string().max(60).nullable().optional(),
  kraName: z.string().max(120).nullable().optional(),
  fatcaStatus: z.enum(["pending", "verified", "expired"]).nullable().optional(),
  fatcaExpiryAt: z.string().nullable().optional(),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["investor.view.all", "investor.view.assigned"], session.permissions);

    const result = await withTenant(session.tenantId, async (tx) => {
      const inv = (await tx.select().from(investors).where(and(eq(investors.id, id), eq(investors.tenantId, session.tenantId))).limit(1))[0];
      if (!inv) return null;

      // The data wall (lib/auth/data-scope.ts) — the same rule the list page
      // enforces. Holding the view capability says you may see SOME clients;
      // this says whether you may see THIS one. Without it, changing the id in
      // the URL/mobile request was a way past a walled list straight to any
      // client's PAN, DOB, address and portfolio.
      await assertInScope(tx, session, { branchId: inv.branchId, ownerId: [inv.rmId, inv.serviceRmId] }, "client");

      const [foliosRows, sipsRows, goalsRows, commsRows, tasksRows, srRows] = await Promise.all([
        tx.select().from(folios).where(eq(folios.investorId, id)),
        tx.select().from(sips).where(eq(sips.investorId, id)),
        tx.select().from(goals).where(eq(goals.investorId, id)),
        tx
          .select()
          .from(communications)
          .where(eq(communications.investorId, id))
          .orderBy(desc(communications.createdAt))
          .limit(10),
        tx.select().from(tasks).where(eq(tasks.subjectId, id)).limit(20),
        tx.select().from(serviceRequests).where(eq(serviceRequests.investorId, id)).limit(20),
      ]);

      // Log PII access (DPDP requirement)
      await tx.insert(auditLog).values({
        tenantId: session.tenantId,
        actorUserId: session.userId,
        actorType: "user",
        action: "investor.view",
        entityType: "investor",
        entityId: id,
        piiAccessed: { pan: !!inv.pan, dob: !!inv.dob, address: !!inv.address } as any,
        reason: "investor 360 page",
      } as any);

      return {
        investor: inv,
        folios: foliosRows,
        sips: sipsRows,
        goals: goalsRows,
        communications: commsRows,
        tasks: tasksRows,
        serviceRequests: srRows,
      };
    });

    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["investor.edit.all", "investor.edit.assigned"], session.permissions);
    const parse = Patch.safeParse(await req.json().catch(() => ({})));
    if (!parse.success)
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });

    const result = await withTenant(session.tenantId, async (tx) => {
      const before = (await tx.select().from(investors).where(and(eq(investors.id, id), eq(investors.tenantId, session.tenantId))).limit(1))[0];
      if (!before) return null;

      // Row scope. PATCH used to require investor.edit.all, a firm-wide
      // capability, so it never needed a per-row check. Now that an
      // assigned-only RM can edit, the check has to exist or widening the
      // capability would let any RM edit any client in the firm. Runs the same
      // wall as the list/GET — back office and the owner clear it unconditionally.
      await assertInScope(tx, session, { branchId: before.branchId, ownerId: [before.rmId, before.serviceRmId] }, "client");

      // Optimistic concurrency: reject if the record moved under the editor.
      // 1s tolerance absorbs sub-second clock/serialisation drift.
      if (parse.data.expectedUpdatedAt && before.updatedAt) {
        const dbTs = new Date(before.updatedAt as any).getTime();
        const expTs = new Date(parse.data.expectedUpdatedAt).getTime();
        if (Number.isFinite(expTs) && Math.abs(dbTs - expTs) > 1000) return "stale" as const;
      }

      // Reassigning the RM must stay inside the firm: a uuid from another tenant
      // is a valid uuid but would orphan the client under an RM who can't see
      // them. Verify the target user belongs to this tenant before assigning.
      // Also re-home the client's branch to the NEW RM's own branch — this
      // used to leave branch_id pointing at whoever's branch it happened to
      // already be, so after a reassignment the branch head who could see it
      // (the old RM's) and the branch head who should now be able to (the new
      // RM's) were both wrong. Same fix as the importer (see migration 0218).
      let rmBranchPatch: { branchId?: string | null } = {};
      if (parse.data.rmId !== undefined && parse.data.rmId !== before.rmId) {
        const [u] = await tx
          .select({ id: users.id, branchId: users.branchId })
          .from(users)
          .where(and(eq(users.id, parse.data.rmId), eq(users.tenantId, session.tenantId)))
          .limit(1);
        if (!u) return "bad_rm" as const;
        if (u.branchId) rmBranchPatch = { branchId: u.branchId };
      }
      // A service RM must be a user in THIS firm too (the FK would accept any).
      if (parse.data.serviceRmId && parse.data.serviceRmId !== before.serviceRmId) {
        const [su] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, parse.data.serviceRmId), eq(users.tenantId, session.tenantId)))
          .limit(1);
        if (!su) return "bad_rm" as const;
      }

      // Stamp KYC audit fields when any KYC-related column is touched.
      const touchingKyc =
        parse.data.kycStatus !== undefined ||
        parse.data.nameAsPerPan !== undefined ||
        parse.data.panAadhaarLinkStatus !== undefined ||
        parse.data.residencyStatus !== undefined ||
        parse.data.aadhaarLast4 !== undefined ||
        parse.data.kycValidatedAt !== undefined ||
        parse.data.ckycNumber !== undefined ||
        parse.data.ckycExpiryAt !== undefined;

      // Recompute persisted health from the post-patch state — many edited
      // fields (KYC, nominee, bank, risk profile, review dates) feed the score.
      // Mirror the first nominee / bank entry into the legacy single columns so
      // existing readers (PDFs, proposals, the health score) keep working.
      const mirror: Record<string, unknown> = {};
      if (parse.data.nominees) {
        const n0 = parse.data.nominees[0];
        mirror.nomineeName = n0?.name ?? null;
        mirror.nomineeRelation = n0?.relation ?? null;
        mirror.nomineeDob = n0?.dob ?? null;
      }
      if (parse.data.bankAccounts) {
        const b0 = parse.data.bankAccounts[0];
        mirror.bankName = b0?.bankName ?? null;
        mirror.bankAccountNumberMasked = b0?.accountMasked ?? null;
        mirror.bankIfsc = b0?.ifsc ?? null;
      }
      const merged = { ...before, ...parse.data, ...mirror };
      const health = healthFields(merged as any);

      // When the review cadence changes (preset OR custom days), re-derive the
      // next review date from the last review (or onboarding, or today) so the
      // "Next review" reminder reflects it. Clearing both cadence fields clears
      // nextReviewAt → the client stops appearing in review-due reminders.
      const reviewPatch: Record<string, unknown> = {};
      // Explicit lastReviewAt (timestamp column → coerce the YYYY-MM-DD string).
      if (parse.data.lastReviewAt !== undefined) {
        reviewPatch.lastReviewAt = parse.data.lastReviewAt ? new Date(parse.data.lastReviewAt) : null;
      }
      if (parse.data.reviewFrequency !== undefined || parse.data.reviewFrequencyDays !== undefined || parse.data.lastReviewAt !== undefined) {
        const rf = parse.data.reviewFrequency !== undefined ? parse.data.reviewFrequency : ((before as any).reviewFrequency ?? null);
        const rfd = parse.data.reviewFrequencyDays !== undefined ? parse.data.reviewFrequencyDays : ((before as any).reviewFrequencyDays ?? null);
        // Recompute from the NEW last-review date when one was just supplied —
        // otherwise logging a completed review would leave the next one derived
        // from the stale previous date.
        const newLast = reviewPatch.lastReviewAt as Date | null | undefined;
        const base =
          newLast instanceof Date
            ? newLast
            : before.lastReviewAt
              ? new Date(before.lastReviewAt as any)
              : (before as any).onboardedAt
                ? new Date((before as any).onboardedAt)
                : new Date();
        reviewPatch.nextReviewAt = computeNextReview(base, rf, rfd);
      }
      // An explicitly-set next review ALWAYS wins over the derived value above —
      // assigned last so it overwrites whatever the cadence computed.
      if (parse.data.nextReviewAt !== undefined) {
        reviewPatch.nextReviewAt = parse.data.nextReviewAt ? new Date(parse.data.nextReviewAt) : null;
      }

      // onboardedAt is a timestamp column — coerce the YYYY-MM-DD string to a
      // Date (Drizzle's date column takes anniversaryDate as a string directly).
      const datePatch: Record<string, unknown> = {};
      if (parse.data.onboardedAt !== undefined) {
        datePatch.onboardedAt = parse.data.onboardedAt ? new Date(parse.data.onboardedAt) : null;
      }

      const after = await tx
        .update(investors)
        .set({
          ...parse.data,
          ...reviewPatch,
          ...datePatch,
          ...mirror,
          ...rmBranchPatch,
          ...(parse.data.uccCodes !== undefined ? { uccCodes: cleanUccCodes(parse.data.uccCodes) } : {}),
          // De-duplicate rather than trusting the client: the tag chips and the
          // free-text box can both produce "Motilal Oswal".
          ...(parse.data.tags !== undefined ? { tags: normaliseTags(parse.data.tags) } : {}),
          updatedAt: new Date(),
          ...(touchingKyc
            ? { kycLastUpdatedBy: session.userId }
            : {}),
          ...health,
        } as any)
        .where(and(eq(investors.id, id), eq(investors.tenantId, session.tenantId)))
        .returning();

      // Advance the lead-to-client blueprint when this edit is the real-world
      // signal for a journey milestone (UCC activated / mandate registered).
      // Previously the onboarding tracker only moved on a manual click — a
      // client's actual UCC/mandate data changing here never touched it, so
      // the tracker silently fell behind the real state. Same forward-only
      // guard pattern as /api/investors/[id]/kyc/verify: only fires from a
      // stage strictly BEFORE the milestone, so re-saving an already-active
      // client's record can never drag the blueprint backward.
      const afterRow = after[0] as typeof before | undefined;
      if (afterRow) {
        const uccJustActivated = !before.bseUccCode && !!afterRow.bseUccCode;
        const mandateJustActivated = before.mandateStatus !== "active" && afterRow.mandateStatus === "active";
        const mandateJustRejected = before.mandateStatus !== "rejected" && afterRow.mandateStatus === "rejected";

        if (uccJustActivated || mandateJustActivated || mandateJustRejected) {
          try {
            const leadId = await resolveLeadIdForInvestor(tx, id);
            if (leadId) {
              const cur = await tx.execute(
                sql`SELECT current_stage_key FROM lead_blueprint_instances WHERE tenant_id = ${session.tenantId}::uuid AND lead_id = ${leadId}::uuid LIMIT 1`
              );
              const stage = (cur.rows[0] as any)?.current_stage_key as string | undefined;

              if (uccJustActivated && stage && PRE_UCC_STAGES.has(stage)) {
                await autoAdvance(tx, session.tenantId, leadId, "ucc.activated", {
                  remarks: "Auto: UCC code recorded on the client.",
                });
              } else if (mandateJustActivated && stage && PRE_MANDATE_STAGES.has(stage)) {
                await autoAdvance(tx, session.tenantId, leadId, "mandate.activated", {
                  remarks: "Auto: mandate marked active on the client.",
                });
              } else if (mandateJustRejected && stage === "mandate_create") {
                await autoAdvance(tx, session.tenantId, leadId, "mandate.rejected", {
                  remarks: "Auto: mandate marked rejected on the client.",
                });
              }
            }
          } catch {
            /* best-effort — never block the client edit on a blueprint hiccup */
          }
        }
      }

      await tx.insert(eventsOutbox).values({
        tenantId: session.tenantId,
        kind: "investor.updated",
        entityType: "investor",
        entityId: id,
        before: before as any,
        after: after[0] as any,
        meta: { userId: session.userId } as any,
      } as any);

      // A family is reviewed as a household. When the head's review date moves,
      // carry it to the members so they stop reading as overdue.
      if (reviewPatch.lastReviewAt instanceof Date) {
        await propagateFamilyReview(tx, session.tenantId, id, reviewPatch.lastReviewAt);
      }

      // Attribute the edit on the audit trail so "last modified by" reflects it
      // (the change-log drawer + RecordProvenance read this).
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "investor.update",
        entityType: "investor",
        entityId: id,
        before: before as any,
        after: after[0] as any,
        ...clientMetaFromHeaders(req.headers),
      });

      // Register any newly-uploaded nominee PAN files as client documents.
      await registerNomineePanDocs(tx, session.tenantId, id, parse.data.nominees, session.userId);

      // A member's KYC/nominee/risk/etc. feeds its family's health too —
      // re-score the family this investor belongs to (no-op if unlinked).
      await recomputeFamilyHealthForInvestor(tx, id);

      return after[0];
    });

    if (result === "bad_rm") return NextResponse.json({ error: "selected RM is not a user in this firm" }, { status: 400 });
    if (result === "stale") return NextResponse.json({ error: "This client was changed by someone else since you opened it. Reload and re-apply your edits." }, { status: 409 });
    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    // Permanent erasure is far more dangerous than an edit — gate on the narrow
    // delete capability (owner / compliance), not the broad edit.all.
    requireCap(session.roles, "investor.delete", session.permissions);
    // Default delete = soft-delete into the Trash bin (recoverable until the
    // retention window elapses). `?purge=1` (Trash → "Delete permanently") does
    // the irreversible hard delete + cascade.
    const purge = req.nextUrl.searchParams.get("purge") === "1";

    const outcome = await withTenant(session.tenantId, async (tx) => {
      const [inv] = await tx
        .select({
          name: investors.name, pan: investors.pan, branchId: investors.branchId,
          rmId: investors.rmId, serviceRmId: investors.serviceRmId,
        })
        .from(investors)
        .where(and(eq(investors.id, id), eq(investors.tenantId, session.tenantId)))
        .limit(1);
      if (!inv) return "not_found" as const;

      // Deleting (even soft-delete) is an edit of the client record and goes
      // through the same wall — investor.delete is narrow (owner/compliance),
      // but compliance is walled to its own branch like every other role, so
      // this is the one place that narrow grant could still reach a client
      // outside it without this check.
      await assertInScope(tx, session, { branchId: inv.branchId, ownerId: [inv.rmId, inv.serviceRmId] }, "client");

      if (!purge) {
        // ── Soft delete → Trash bin. Preserves the whole owned-data subgraph so
        // recovery (clearing deleted_at) restores the client intact.
        await tx
          .update(investors)
          .set({ deletedAt: new Date(), deletedBy: session.userId, updatedAt: new Date() } as any)
          .where(and(eq(investors.id, id), eq(investors.tenantId, session.tenantId)));
        await tx.insert(auditLog).values({
          tenantId: session.tenantId,
          actorUserId: session.userId,
          action: "investor.trash",
          entityType: "investor",
          entityId: id,
          before: { name: inv.name, pan: inv.pan } as any,
        } as any);
        return "trashed" as const;
      }

      // Audit BEFORE the row + its owned-data subgraph are removed.
      await tx.insert(auditLog).values({
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "investor.delete",
        entityType: "investor",
        entityId: id,
        before: { name: inv.name, pan: inv.pan } as any,
      } as any);

      // Documents link to the client polymorphically (no FK), so the cascade
      // won't reach them — remove them explicitly.
      await tx
        .delete(complianceDocuments)
        .where(
          and(
            eq(complianceDocuments.tenantId, session.tenantId),
            eq(complianceDocuments.relatedEntityType, "investor"),
            eq(complianceDocuments.relatedEntityId, id)
          )
        );

      // Non-FK references: these tables point at the client by a plain uuid, so
      // the FK cascade (migration 0131) never reaches them. Remove the client's
      // rows explicitly so NO module keeps orphaned data after a purge; detach
      // (null) the pointers on records that legitimately outlive the client
      // (leads that converted from/were referred by them, family primary anchor,
      // and any minor whose guardian was this client).
      const T = session.tenantId;
      await tx.delete(tasks).where(and(eq(tasks.tenantId, T), eq(tasks.relatedInvestorId, id)));
      await tx.delete(reviewMeetings).where(and(eq(reviewMeetings.tenantId, T), eq(reviewMeetings.investorId, id)));
      await tx.delete(sipRejections).where(and(eq(sipRejections.tenantId, T), eq(sipRejections.investorId, id)));
      await tx.delete(onboardingPipelines).where(and(eq(onboardingPipelines.tenantId, T), eq(onboardingPipelines.investorId, id)));
      await tx.delete(riskProfileResponses).where(and(eq(riskProfileResponses.tenantId, T), eq(riskProfileResponses.investorId, id)));
      await tx.delete(activities).where(and(eq(activities.tenantId, T), eq(activities.subjectType, "investor"), eq(activities.subjectId, id)));
      await tx.delete(shareTokens).where(and(eq(shareTokens.tenantId, T), eq(shareTokens.subjectType, "investor"), eq(shareTokens.subjectId, id)));
      await tx.delete(financialDiscoveries).where(and(eq(financialDiscoveries.tenantId, T), eq(financialDiscoveries.subjectType, "investor"), eq(financialDiscoveries.subjectId, id)));
      await tx.update(leads).set({ convertedInvestorId: null } as any).where(and(eq(leads.tenantId, T), eq(leads.convertedInvestorId, id)));
      await tx.update(leads).set({ referredByInvestorId: null } as any).where(and(eq(leads.tenantId, T), eq(leads.referredByInvestorId, id)));
      await tx.update(families).set({ primaryInvestorId: null } as any).where(and(eq(families.tenantId, T), eq(families.primaryInvestorId, id)));
      await tx.update(investors).set({ guardianInvestorId: null } as any).where(and(eq(investors.tenantId, T), eq(investors.guardianInvestorId, id)));

      // Permanent hard delete — folios/transactions/sips/proposals/goals/etc.
      // cascade automatically (migration 0131).
      await tx
        .delete(investors)
        .where(and(eq(investors.id, id), eq(investors.tenantId, session.tenantId)));
      return "ok" as const;
    });
    if (outcome === "not_found") return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true, trashed: outcome === "trashed" });
  } catch (err: any) {
    return handleApiError(err);
  }
}
