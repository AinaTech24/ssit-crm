import { handleApiError } from "@/lib/api/error-handler";
/**
 * Review meetings — collection endpoint.
 *
 *   GET  /api/review-meetings   — list with investor + RM joined
 *   POST /api/review-meetings   — schedule a new meeting
 *
 * Automations fired on create:
 *   1. Insert a reminder task for the RM (1 day before the meeting)
 *   2. Outbox event so any subscribed workflow can hook in (WA reminder, etc.)
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { sql, eq, and } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { resolveMeetingScope, meetingScopeSql } from "@/lib/auth/data-scope";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { autoAdvance, resolveLeadIdForInvestor } from "@/lib/blueprints/auto-advance";
import { findRmConflicts } from "@/lib/review-meetings/conflicts";
import {
  reviewMeetings,
  investors,
  leads,
  tasks,
  eventsOutbox,
  REVIEW_MEETING_TYPES,
  REVIEW_MEETING_MODES,
  MEETING_CATEGORIES,
} from "@/db/schema";

export const dynamic = "force-dynamic";

const Body = z
  .object({
    // Exactly one of these must be set — refined below.
    investorId: z.string().uuid().optional(),
    leadId: z.string().uuid().optional(),
    familyId: z.string().uuid().optional(),
    collaboratorIds: z.array(z.string().uuid()).max(20).optional(),
    category: z.enum(MEETING_CATEGORIES).default("review"),
    parentMeetingId: z.string().uuid().optional(),
    meetingType: z.enum(REVIEW_MEETING_TYPES),
    /** Optional free-text headline. */
    subject: z.string().max(300).optional(),
    meetingDate: z.string(), // ISO datetime
    durationMinutes: z.number().int().positive().default(30),
    meetingMode: z.enum(REVIEW_MEETING_MODES),
    locationOrLink: z.string().optional(),
    discussionPoints: z.string().optional(),
    /** Initial status — defaults to scheduled. */
    status: z.enum(["scheduled", "confirmed"]).default("scheduled"),
    /** Override the RM double-booking guard (user clicked "Schedule anyway"). */
    force: z.boolean().default(false),
  })
  .refine((b) => Boolean(b.investorId) !== Boolean(b.leadId), {
    message: "Provide exactly one of investorId or leadId",
    path: ["investorId"],
  });

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    // Was wide-open to any session. Require the meeting capability, and scope
    // RMs (manage.assigned, not .all) to their OWN meetings.
    requireAny(session.roles, ["review_meeting.manage.all", "review_meeting.manage.assigned"], session.permissions);

    // Full filter set, mirroring the web list page (/dashboard/review-meetings).
    const url = req.nextUrl;
    const g = (k: string) => url.searchParams.get(k) ?? "";
    const csv = (v: string) => v.split(",").map((s) => s.trim()).filter(Boolean);
    const q = g("q").trim();
    const categoryFilter = csv(g("category"));
    const statusFilter = csv(g("status"));
    const modeFilter = csv(g("mode"));
    const typeFilter = csv(g("type"));
    const rmFilter = csv(g("rm")).filter((v) => /^[0-9a-f-]{36}$/i.test(v));
    const sortAsc = g("sort") === "meeting_asc";
    // Optional filter — used by the lead blueprint's inline "complete meeting"
    // popup to load only this lead's meetings.
    const leadIdRaw = g("leadId");
    const leadId = /^[0-9a-f-]{36}$/i.test(leadIdRaw) ? leadIdRaw : null;
    const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
    const mFrom = g("meeting_from") || g("meeting");
    const mTo = g("meeting_to") || g("meeting_end");

    const data = await withTenant(
      session.tenantId,
      async (tx) => {
        // The same data wall every other module runs. review_meetings has no
        // branch_id of its own, so branch scope is derived from the RM's own
        // branch on `users` — this is what lets a branch head see every RM in
        // their branch's meetings, not only meetings they personally ran.
        const meetingScope = await resolveMeetingScope(tx, session);
        const filters: any[] = [
          sql`m.tenant_id = ${session.tenantId}::uuid`,
          meetingScopeSql(meetingScope, "m.rm_id"),
        ];
        if (leadId) filters.push(sql`m.lead_id = ${leadId}::uuid`);
        if (q) filters.push(sql`(i.name ILIKE ${`%${q}%`} OR l.name ILIKE ${`%${q}%`} OR u.name ILIKE ${`%${q}%`} OR m.discussion_points ILIKE ${`%${q}%`} OR m.meeting_notes ILIKE ${`%${q}%`})`);
        if (categoryFilter.length) filters.push(sql`m.category IN (${sql.join(categoryFilter.map((v) => sql`${v}`), sql`, `)})`);
        if (statusFilter.length) filters.push(sql`m.status IN (${sql.join(statusFilter.map((v) => sql`${v}`), sql`, `)})`);
        if (modeFilter.length) filters.push(sql`m.meeting_mode IN (${sql.join(modeFilter.map((v) => sql`${v}`), sql`, `)})`);
        if (typeFilter.length) filters.push(sql`m.meeting_type IN (${sql.join(typeFilter.map((v) => sql`${v}`), sql`, `)})`);
        if (rmFilter.length) filters.push(sql`m.rm_id IN (${sql.join(rmFilter.map((v) => sql`${v}::uuid`), sql`, `)})`);
        if (isDate(mFrom)) filters.push(sql`m.meeting_date >= ${mFrom}::date`);
        if (isDate(mTo)) filters.push(sql`m.meeting_date < (${mTo}::date + interval '1 day')`);
        const whereSql = sql.join(filters, sql` AND `);

        const meetings = await tx.execute(sql`
          SELECT m.*, COALESCE(i.name, l.name) AS investor_name,
                 i.segment_tag, i.pan AS investor_pan,
                 u.name AS rm_name
          FROM review_meetings m
          LEFT JOIN investors i ON i.id = m.investor_id
          LEFT JOIN leads l ON l.id = m.lead_id
          LEFT JOIN users u ON u.id = m.rm_id
          WHERE ${whereSql}
          ORDER BY ${sortAsc ? sql`m.meeting_date ASC` : sql`m.meeting_date DESC`}
          LIMIT 500
        `);

        // Stats ribbon — the 4 fixed metrics, scoped to tenant + the same wall.
        const statsRes = await tx.execute(sql`
          SELECT
            COUNT(*) FILTER (WHERE status IN ('scheduled','confirmed') AND meeting_date >= now())::int AS upcoming,
            COUNT(*) FILTER (WHERE status IN ('scheduled','confirmed') AND meeting_date >= date_trunc('week', now()) AND meeting_date < date_trunc('week', now()) + interval '7 days')::int AS this_week,
            COUNT(*) FILTER (WHERE status = 'completed' AND meeting_date >= date_trunc('month', now()))::int AS completed_mtd,
            COUNT(*) FILTER (WHERE status IN ('scheduled','confirmed','in_progress') AND meeting_date < now())::int AS overdue
          FROM review_meetings
          WHERE tenant_id = ${session.tenantId}::uuid
            AND ${meetingScopeSql(meetingScope, "rm_id")}
        `);

        return { meetings: meetings.rows, stats: (statsRes.rows[0] ?? { upcoming: 0, this_week: 0, completed_mtd: 0, overdue: 0 }) };
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    return NextResponse.json({ meetings: data.meetings, stats: data.stats });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    // RMs (manage.assigned) may schedule meetings too — not just back-office (.all).
    requireAny(session.roles, ["review_meeting.manage.all", "review_meeting.manage.assigned"], session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const body = parse.data;
    const clientMeta = clientMetaFromHeaders(req.headers);

    const result = await withTenant(session.tenantId, async (tx) => {
      // Resolve the subject — investor OR lead. The XOR was enforced by zod.
      let subjectName = "";
      let subjectRmId: string | null = null;
      let subjectType: "investor" | "lead" = "investor";
      let subjectId = "";
      if (body.investorId) {
        const inv = (await tx.select().from(investors).where(and(eq(investors.id, body.investorId), eq(investors.tenantId, session.tenantId))).limit(1))[0];
        if (!inv) throw Object.assign(new Error("investor not found"), { status: 404 });
        subjectName = inv.name;
        subjectRmId = inv.rmId ?? null;
        subjectType = "investor";
        subjectId = body.investorId;
      } else {
        const ld = (await tx.select().from(leads).where(and(eq(leads.id, body.leadId!), eq(leads.tenantId, session.tenantId))).limit(1))[0];
        if (!ld) throw Object.assign(new Error("lead not found"), { status: 404 });
        subjectName = ld.name;
        subjectRmId = (ld as any).ownerId ?? null;
        subjectType = "lead";
        subjectId = body.leadId!;
      }

      const id = uuid();
      // The person scheduling owns the meeting. The subject's RM is no longer
      // an input — invite them as a collaborator instead.
      const createdById = session.userId;
      const meetingDate = new Date(body.meetingDate);

      // ─── Double-booking guard ──────────────────────────────────────
      // Bail BEFORE any write if this RM already has an overlapping meeting,
      // unless the user explicitly chose "Schedule anyway". Returning here
      // leaves the transaction untouched (no partial reminder/meeting rows).
      if (!body.force) {
        const conflicts = await findRmConflicts(
          tx,
          session.tenantId,
          createdById,
          meetingDate.toISOString(),
          body.durationMinutes
        );
        if (conflicts.length) return { conflicts } as const;
      }

      // ─── Automation 1 — reminder task (1 day before) ───────────────
      const reminderTaskId = uuid();
      const reminderAt = new Date(meetingDate.getTime() - 24 * 60 * 60 * 1000);
      await tx.insert(tasks).values({
        id: reminderTaskId,
        tenantId: session.tenantId,
        branchId: session.branchId ?? null,
        assigneeId: createdById,
        subjectType,
        subjectId,
        type: "review_meeting_reminder",
        title: `Reminder: ${labelForType(body.meetingType)} with ${subjectName} tomorrow`,
        description: `Mode: ${labelForMode(body.meetingMode)}${body.locationOrLink ? " · " + body.locationOrLink : ""}.${body.discussionPoints ? " Agenda: " + body.discussionPoints : ""}`,
        priority: "normal",
        status: "open",
        dueAt: reminderAt,
      } as any);

      await tx.insert(reviewMeetings).values({
        id,
        tenantId: session.tenantId,
        investorId: body.investorId ?? null,
        leadId: body.leadId ?? null,
        familyId: body.familyId ?? null,
        createdById,
        collaboratorIds: body.collaboratorIds ?? [],
        category: body.category,
        parentMeetingId: body.parentMeetingId ?? null,
        meetingType: body.meetingType,
        subject: body.subject ?? null,
        meetingDate,
        durationMinutes: String(body.durationMinutes),
        meetingMode: body.meetingMode,
        locationOrLink: body.locationOrLink ?? null,
        discussionPoints: body.discussionPoints ?? null,
        status: body.status,
        reminderTaskId,
      } as any);

      // Outbox so subscribed workflows can confirm + remind the client. The
      // entity pointer is the *person* (investor/lead) — not the meeting — so a
      // subscribed recipe's subject resolves to someone with a phone/email to
      // message. `reminderAt` (meeting − 1 day, already computed above for the
      // RM reminder task) lets a recipe wait_until_date and fire a day-before
      // reminder. Meeting linkage stays in `after`.
      await tx.insert(eventsOutbox).values({
        tenantId: session.tenantId,
        kind: "review_meeting.scheduled",
        entityType: subjectType,
        entityId: subjectId,
        after: {
          reviewMeetingId: id,
          investorId: body.investorId ?? null,
          leadId: body.leadId ?? null,
          meetingType: body.meetingType,
          meetingDate: meetingDate.toISOString(),
          reminderAt: reminderAt.toISOString(),
          mode: body.meetingMode,
          locationOrLink: body.locationOrLink ?? null,
        },
        meta: { userId: session.userId } as any,
      } as any);

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "review_meeting.create",
        entityType: "review_meeting",
        entityId: id,
        after: {
          investorId: body.investorId ?? null,
          leadId: body.leadId ?? null,
          meetingType: body.meetingType,
          mode: body.meetingMode,
        } as any,
        ...clientMeta,
      });

      // ─── Smart blueprint advance ───────────────────────────────────
      // If this meeting was scheduled against a lead, push the lead's
      // blueprint to `appointment_scheduled` so the user doesn't have to
      // hop to the lead detail page and click Advance.
      if (body.leadId) {
        await autoAdvance(tx, session.tenantId, body.leadId, "meeting.scheduled.lead", {
          remarks: `Auto: ${labelForType(body.meetingType)} scheduled for ${meetingDate.toLocaleDateString("en-IN")}.`,
        });
      }

      return { id, createdById, reminderTaskId };
    });

    // Double-booking: surface the clash so the UI can offer "Schedule anyway".
    if (result && "conflicts" in result) {
      return NextResponse.json({ error: "rm_conflict", conflicts: result.conflicts }, { status: 409 });
    }

    return NextResponse.json(result, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}

function labelForType(t: string): string {
  return t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
function labelForMode(m: string): string {
  return m === "client_place" ? "Client place" : m.charAt(0).toUpperCase() + m.slice(1);
}
