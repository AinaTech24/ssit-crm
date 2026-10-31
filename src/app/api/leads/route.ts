import { handleApiError } from "@/lib/api/error-handler";
/**
 * Leads collection.
 *   GET  /api/leads
 *   POST /api/leads
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense, assertModuleEnabled } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { canEditAllLeads, leadScopeCondition, leadScopeSql, requireLeadView } from "@/lib/leads/access";
import { users } from "@/db/schema";
import {
  normalizeEmail,
  normalizeLeadSource,
  normalizePan,
  normalizePhoneLast10,
} from "@/lib/leads/normalize";
import { leads, eventsOutbox, tasks } from "@/db/schema";
import { scoreFields } from "@/lib/leads/score";
import { loadCustomFieldDefs, sanitizeCustomFields } from "@/lib/custom-fields/values";
import { autoConvertLead } from "@/lib/leads/auto-convert";
import { SUBSCRIPTION_CATEGORIES, SUBSCRIPTION_FREQUENCIES, renewalFrom, todayISO } from "@/lib/subscriptions";

export const dynamic = "force-dynamic";

const CreateBody = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  pan: z.string().optional(),
  city: z.string().optional(),
  // Optional lead photo — storage key (general kind) or URL. Never required.
  avatarUrl: z.string().max(500).optional(),
  source: z
    .enum([
      // Spec-canonical (10)
      "referral", "website", "social_media", "webinar", "seminar",
      "walk_in", "existing_client", "google", "cold_call", "other",
      // Legacy
      "meta_ads", "google_ads", "linkedin", "youtube", "event", "manual",
    ])
    .default("manual"),
  /** Free-text campaign / event name. Carries the event when source="event". */
  sourceCampaign: z.string().max(160).optional(),
  intendedAmount: z.string().optional(),
  /** Canonical pipeline value in rupees (preferred over the free-text amount). */
  expectedBusinessAmount: z.number().min(0).max(1e12).optional(),
  aumPotential: z.enum(["under_10l", "10l_50l", "50l_2cr", "hni_2cr_plus"]).optional(),
  leadType: z.enum(["individual", "hni", "nri", "corporate", "minor"]).optional(),
  /** Products of interest (multi). The column already existed — now captured. */
  interestProducts: z.array(z.string().max(60)).max(20).optional(),
  occupation: z.string().max(120).optional(),
  currentInvestments: z.array(z.string().max(60)).max(20).optional(),
  altPhone: z.string().max(20).optional(),
  altEmail: z.string().email().optional().or(z.literal("")),
  /** First follow-up moment — sets next_follow_up_at + spawns a follow-up task. */
  followUpDate: z.string().datetime().optional().or(z.literal("")),
  notes: z.string().optional(),
  ownerId: z.string().uuid().optional(),
  serviceRmId: z.string().uuid().optional(),
  /** When source is 'referral' or 'existing_client' — link to the referrer in the Clients module. */
  referredByInvestorId: z.string().uuid().optional(),
  referredByName: z.string().max(200).optional(),
  /** When sourced by a channel partner — drives commission split on conversion. */
  subDistributorId: z.string().uuid().optional(),
  /** MFD-defined custom fields — sanitized against the firm's definitions. */
  customFields: z.record(z.string(), z.any()).optional(),
  /** RA sales: subscription category. "subscribed" needs a frequency and auto-converts. */
  subscriptionCategory: z.enum(SUBSCRIPTION_CATEGORIES.map((c) => c.value) as [string, ...string[]]).optional(),
  subscriptionFrequency: z.enum(SUBSCRIPTION_FREQUENCIES.map((f) => f.value) as [string, ...string[]]).optional(),
});

// Lead-phase blueprint stages (mirror of the web list page) — leads live here
// until Convert-to-Client. Excludes converted (converted_investor_id) + archived.
const LEAD_PHASE_STAGES = [
  "new", "call_done", "contacted", "first_call_pending", "call_back_later", "call_not_connected",
  "contact_in_future", "follow_up", "meeting_scheduled", "appointment_scheduled", "qualified",
  "meeting_pending", "meeting_done", "won_lead", "converted", "post_meeting_qualified",
  "not_qualified", "lost", "not_interested", "cold",
];

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await assertModuleEnabled(session.tenantId, "lead_management", session.roles);
    requireLeadView(session);

    const url = new URL(req.url);
    const g = (k: string) => url.searchParams.get(k) ?? "";
    const csv = (v: string) => v.split(",").filter(Boolean);
    const q = g("q").trim();
    const stageFilter = csv(g("stage"));
    const sourceFilter = csv(g("source"));
    const ownerFilter = csv(g("owner"));
    const qf = {
      mine: g("mine") === "1", unassigned: g("unassigned") === "1", hot: g("hot") === "1",
      stuck: g("stuck") === "1", followup_today: g("followup_today") === "1",
      followup_overdue: g("followup_overdue") === "1", new_week: g("new_week") === "1",
    };
    const createdFrom = g("created_from"), createdTo = g("created_to");
    const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
    const sortKey = g("sort") === "recent" ? "recent" : "score";
    const dirSql = sql.raw(g("dir") === "asc" ? "ASC" : "DESC");
    const page = Math.max(1, Number(g("page") || "1") || 1);
    const limit = Math.min(400, Math.max(1, Number(g("limit") || "50") || 50));

    const result = await withTenant(
      session.tenantId,
      async (tx) => {
        const conds: any[] = [
          sql`leads.stage IN (${sql.join(LEAD_PHASE_STAGES.map((s) => sql`${s}`), sql`, `)})`,
          sql`leads.lost_reason IS DISTINCT FROM '__deleted__'`,
          sql`leads.deleted_at IS NULL`,
          sql`leads.converted_investor_id IS NULL`,
          await leadScopeSql(tx, session, "leads"),
        ];
        if (q) conds.push(sql`(leads.name ILIKE ${`%${q}%`} OR leads.phone ILIKE ${`%${q}%`} OR leads.email ILIKE ${`%${q}%`} OR users.name ILIKE ${`%${q}%`})`);
        if (stageFilter.length) conds.push(sql`leads.stage IN (${sql.join(stageFilter.map((v) => sql`${v}`), sql`, `)})`);
        if (sourceFilter.length) conds.push(sql`leads.source IN (${sql.join(sourceFilter.map((v) => sql`${v}`), sql`, `)})`);
        if (ownerFilter.length) conds.push(sql`leads.owner_id IN (${sql.join(ownerFilter.map((v) => sql`${v}::uuid`), sql`, `)})`);
        if (qf.mine) conds.push(sql`leads.owner_id = ${session.userId}::uuid`);
        if (qf.unassigned) conds.push(sql`leads.owner_id IS NULL`);
        if (qf.hot) conds.push(sql`leads.score_band = 'hot'`);
        if (qf.stuck) conds.push(sql`COALESCE(leads.stage_changed_at, leads.updated_at, leads.created_at) < now() - interval '14 days'`);
        if (qf.followup_today) conds.push(sql`leads.next_follow_up_at::date = current_date`);
        if (qf.followup_overdue) conds.push(sql`leads.next_follow_up_at IS NOT NULL AND leads.next_follow_up_at < now()`);
        if (qf.new_week) conds.push(sql`leads.created_at >= now() - interval '7 days'`);
        if (isDate(createdFrom)) conds.push(sql`leads.created_at >= ${createdFrom}::date`);
        if (isDate(createdTo)) conds.push(sql`leads.created_at < (${createdTo}::date + interval '1 day')`);
        const whereClause = sql.join(conds, sql` AND `);

        const orderBy = sortKey === "recent" ? sql`leads.updated_at ${dirSql}` : sql`leads.lead_score ${dirSql}, leads.updated_at DESC`;

        const totalRes = await tx.select({ c: sql<number>`count(*)::int` }).from(leads).leftJoin(users, eq(users.id, leads.ownerId)).where(whereClause as any);
        const rows = await tx
          .select({ lead: leads, owner: users.name })
          .from(leads)
          .leftJoin(users, eq(users.id, leads.ownerId))
          .where(whereClause as any)
          .orderBy(orderBy as any)
          .limit(limit)
          .offset((page - 1) * limit);

        return { rows: rows.map((r) => ({ ...r.lead, ownerName: r.owner })), total: Number(totalRes[0]?.c ?? 0) };
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    return NextResponse.json({ leads: result.rows, total: result.total, page, limit });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    // Allow lead.edit.all (marketing) OR lead.edit.assigned (rm). Owner
    // always wins via the can() override. branch_head doesn't have a
    // dedicated lead-edit cap in the matrix — treat as edit.assigned.
    requireAny(session.roles, ["lead.create"], session.permissions);
    await assertModuleEnabled(session.tenantId, "lead_management", session.roles);
    await assertActiveLicense(session.tenantId, session.roles);

    const parse = CreateBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const body = parse.data;
    if (body.subscriptionCategory === "subscribed" && !body.subscriptionFrequency) {
      return NextResponse.json({ error: "Choose how often they subscribe (quarterly, half-yearly or yearly)." }, { status: 400 });
    }
    const subscribed = body.subscriptionCategory === "subscribed";
    const subStart = subscribed ? todayISO() : null;

    const id = uuid();
    const clientMeta = clientMetaFromHeaders(req.headers);
    let assignedOwnerId: string | null = null;
    let assignedVia: "manual" | "creator" = "creator";
    let assignedServiceRmId: string | null = null;

    await withTenant(session.tenantId, async (tx) => {
      // Owner: whoever CREATES the lead owns it. Round-robin / assignment-rule
      // auto-assignment was removed here at the firm's request — a lead typed in
      // by an RM is that RM's lead. A user who can manage every lead may still
      // hand it to someone else explicitly via body.ownerId.
      // (The public lead-capture forms have no creator, so those still
      //  round-robin — see /api/public/lead-forms/[slug].)
      if (body.ownerId && canEditAllLeads(session)) {
        assignedOwnerId = body.ownerId;
        assignedVia = "manual";
      } else {
        assignedOwnerId = session.userId;
        assignedVia = "creator";
      }

      // Service RM: same rule as the owner — only someone who manages every lead
      // can name it, and it must be a user of this firm.
      if (body.serviceRmId && canEditAllLeads(session)) {
        const [u] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, body.serviceRmId), eq(users.tenantId, session.tenantId)))
          .limit(1);
        if (u) assignedServiceRmId = u.id;
      }

      // Canonical pipeline value wins; keep intended_amount populated (from it)
      // so legacy scoring + old readers keep working.
      const intendedAmount =
        body.intendedAmount ??
        (body.expectedBusinessAmount != null ? String(body.expectedBusinessAmount) : null);
      const followUpAt =
        body.followUpDate && body.followUpDate !== "" ? new Date(body.followUpDate) : null;

      // Sanitize firm custom fields against their definitions before storing.
      const cfDefs = await loadCustomFieldDefs(tx, session.tenantId, "lead");
      const customFields = sanitizeCustomFields(cfDefs, body.customFields);

      const inserted = await tx
        .insert(leads)
        .values({
          id,
          tenantId: session.tenantId,
          branchId: session.branchId,
          name: body.name,
          email: body.email || null,
          emailNormalized: normalizeEmail(body.email),
          phone: body.phone || null,
          phoneNormalized: normalizePhoneLast10(body.phone),
          pan: normalizePan(body.pan),
          city: body.city || null,
          avatarUrl: body.avatarUrl || null,
          source: normalizeLeadSource(body.source),
          sourceCampaign: body.sourceCampaign || null,
          stage: "new",
          stageChangedAt: new Date(),
          intendedAmount,
          expectedBusinessAmount:
            body.expectedBusinessAmount != null ? String(body.expectedBusinessAmount) : null,
          aumPotential: body.aumPotential ?? null,
          leadType: body.leadType ?? null,
          interestProducts: body.interestProducts ?? [],
          profile: {
            ...(body.occupation ? { occupation: body.occupation } : {}),
            ...(body.currentInvestments?.length ? { currentInvestments: body.currentInvestments } : {}),
          },
          altPhone: body.altPhone || null,
          altEmail: body.altEmail || null,
          nextFollowUpAt: followUpAt,
          notes: body.notes,
          ownerId: assignedOwnerId,
          serviceRmId: assignedServiceRmId,
          referredByInvestorId: body.referredByInvestorId ?? null,
          referredByName: body.referredByName ?? null,
          subDistributorId: body.subDistributorId ?? null,
          subscriptionCategory: body.subscriptionCategory ?? null,
          subscriptionFrequency: subscribed ? body.subscriptionFrequency ?? null : null,
          subscriptionStartedAt: subStart,
          subscriptionRenewalAt: subStart ? renewalFrom(subStart, body.subscriptionFrequency) : null,
          customFields: Object.keys(customFields).length ? customFields : null,
          // Deterministic initial score from the captured signals.
          ...scoreFields({
            source: normalizeLeadSource(body.source),
            stage: "new",
            intendedAmount,
            stageChangedAt: new Date(),
            email: body.email || null,
            phone: body.phone || null,
            pan: normalizePan(body.pan),
          }),
        } as any)
        .returning();

      // First follow-up — set on the lead above + spawn a task the RM sees in
      // their queue (mirrors how the call-outcome flow creates follow-ups).
      if (followUpAt && !Number.isNaN(followUpAt.getTime())) {
        await tx.insert(tasks).values({
          tenantId: session.tenantId,
          subjectType: "lead",
          subjectId: id,
          relatedLeadId: id,
          type: "follow_up",
          title: `Follow-up: ${body.name}`,
          description: body.notes ?? null,
          priority: "normal",
          status: "open",
          assigneeId: assignedOwnerId ?? session.userId,
          createdById: session.userId,
          department: "sales",
          dueAt: followUpAt,
        } as any);
      }

      await tx.insert(eventsOutbox).values({
        tenantId: session.tenantId,
        kind: "lead.created",
        entityType: "lead",
        entityId: id,
        after: inserted[0] as any,
        meta: { userId: session.userId, assignedVia, assignedOwnerId } as any,
      } as any);

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "lead.create",
        entityType: "lead",
        entityId: id,
        after: { name: body.name, source: body.source, stage: "new", ownerId: assignedOwnerId, assignedVia },
        ...clientMeta,
      });
    });

    // Subscribed means a paying client: convert straight away.
    const conv = subscribed ? await autoConvertLead(req, id) : null;

    return NextResponse.json(
      { id, ownerId: assignedOwnerId, assignedVia, converted: conv?.converted ?? false, investorId: conv?.investorId, convertError: conv?.error },
      { status: 201 }
    );
  } catch (err: any) {
    return handleApiError(err);
  }
}
