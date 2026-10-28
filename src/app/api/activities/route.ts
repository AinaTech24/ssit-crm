import { handleApiError } from "@/lib/api/error-handler";
/**
 * Activities — the unified interaction log (Sanchay "Calls" + "Check In").
 *
 *   GET  /api/activities   — list (RLS-scoped). Filters: kind, subjectType,
 *                            subjectId, mine, q, from/to.
 *   POST /api/activities   — log a call / visit / note against a client,
 *                            lead, or family. subjectName/Phone are resolved
 *                            server-side from the subject record.
 *
 * Listing is firm-wide for managers (owner/branch_head/compliance) and
 * own-logged for everyone else, mirroring the other activity surfaces.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { dataScopeSqlFor } from "@/lib/auth/data-scope";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { assertCanViewClient } from "@/lib/investors/access";
import { notifyClientTeam } from "@/lib/notifications/client-team";
import {
  ACTIVITY_KINDS,
  ACTIVITY_DIRECTIONS,
  ACTIVITY_STATUSES,
  ACTIVITY_SUBJECT_TYPES,
  activities,
} from "@/db/schema";

export const dynamic = "force-dynamic";

const Body = z.object({
  subjectType: z.enum(ACTIVITY_SUBJECT_TYPES),
  subjectId: z.string().uuid(),
  kind: z.enum(ACTIVITY_KINDS).default("call"),
  direction: z.enum(ACTIVITY_DIRECTIONS).optional(),
  status: z.enum(ACTIVITY_STATUSES).optional(),
  subject: z.string().max(200).optional(),
  notes: z.string().max(4000).optional(),
  occurredAt: z.string().datetime().optional(),
  durationSec: z.number().int().min(0).max(86400).optional(),
  geoLat: z.number().min(-90).max(90).optional(),
  geoLng: z.number().min(-180).max(180).optional(),
  locationLabel: z.string().max(200).optional(),
  nextFollowupAt: z.string().datetime().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const firmWide = can(session.roles, "dashboard.view.owner", (session as any).permissions);
    const sp = req.nextUrl.searchParams;
    const kind = (sp.get("kind") ?? "").split(",").filter(Boolean);
    const subjectType = sp.get("subjectType") ?? "";
    const subjectId = sp.get("subjectId") ?? "";
    const mine = sp.get("mine") === "1";
    const q = (sp.get("q") ?? "").trim();
    const from = sp.get("from") ?? "";
    const to = sp.get("to") ?? "";

    const data = await withTenant(
      session.tenantId,
      async (tx) => {
        const conds: any[] = [
          sql`a.tenant_id = ${session.tenantId}::uuid`,
          await dataScopeSqlFor(tx, session, { branch: "a.branch_id", owner: "a.owner_user_id" }),
        ];
        if (kind.length) conds.push(sql`a.kind IN (${sql.join(kind.map((k) => sql`${k}`), sql`, `)})`);
        if (subjectType) conds.push(sql`a.subject_type = ${subjectType}`);
        if (subjectId) conds.push(sql`a.subject_id = ${subjectId}::uuid`);
        if (q) conds.push(sql`(a.subject_name ILIKE ${`%${q}%`} OR a.subject ILIKE ${`%${q}%`} OR a.notes ILIKE ${`%${q}%`})`);
        if (from) conds.push(sql`a.occurred_at >= ${from}::timestamptz`);
        if (to) conds.push(sql`a.occurred_at < (${to}::date + 1)`);
        if (mine || !firmWide) conds.push(sql`a.owner_user_id = ${session.userId}::uuid`);
        const whereSql = sql`WHERE ${sql.join(conds, sql` AND `)}`;

        const r = await tx.execute(sql`
          SELECT a.id, a.subject_type, a.subject_id, a.subject_name, a.subject_phone,
                 a.kind, a.direction, a.status, a.subject, a.notes, a.occurred_at,
                 a.duration_sec, a.location_label, a.next_followup_at, a.owner_user_id,
                 u.name AS owner_name
          FROM activities a
          LEFT JOIN users u ON u.id = a.owner_user_id
          ${whereSql}
          ORDER BY a.occurred_at DESC
          LIMIT 300
        `);

        // KPI ribbon — over the tenant (+ own-logged) scope only, mirroring web.
        const scope = mine || !firmWide ? sql` AND owner_user_id = ${session.userId}::uuid` : sql``;
        const statsRes = await tx.execute(sql`
          SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE kind = 'call' AND occurred_at::date = current_date)::int AS calls_today,
            COUNT(*) FILTER (WHERE kind = 'visit' AND occurred_at >= current_date - 6)::int AS visits_week,
            COUNT(*) FILTER (WHERE next_followup_at IS NOT NULL AND next_followup_at::date <= current_date)::int AS followups_due
          FROM activities WHERE tenant_id = ${session.tenantId}::uuid${scope}
        `);
        return { activities: r.rows as any[], stats: (statsRes.rows[0] ?? {}) as any };
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );
    return NextResponse.json({ activities: data.activities, stats: data.stats });
  } catch (err: any) {
    return handleApiError(err);
  }
}

/** Resolve a denormalised name + phone for the polymorphic subject. */
function subjectLookupSql(subjectType: string, subjectId: string) {
  if (subjectType === "investor")
    return sql`SELECT name, phone, rm_id, service_rm_id FROM investors WHERE id = ${subjectId}::uuid LIMIT 1`;
  if (subjectType === "lead")
    return sql`SELECT name, phone, owner_id FROM leads WHERE id = ${subjectId}::uuid LIMIT 1`;
  return sql`SELECT COALESCE(family_name, head_name) AS name, NULL::text AS phone, NULL::uuid AS owner_id FROM families WHERE id = ${subjectId}::uuid LIMIT 1`;
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const b = parse.data;
    const meta = clientMetaFromHeaders(req.headers);
    const id = uuid();

    const seesAllInvestors = can(session.roles, "investor.view.all", session.permissions);
    const seesAllLeads = can(session.roles, "lead.view.all", session.permissions);

    const result = await withTenant(
      session.tenantId,
      async (tx) => {
        // Verify the subject exists in this tenant + capture denormalised name/phone.
        const subj = await tx.execute(subjectLookupSql(b.subjectType, b.subjectId));
        const sr = subj.rows[0] as any;
        if (!sr) return { notFound: true as const };

        // Whoever may OPEN the client may log an interaction on it: its RM, its
        // Service RM, or anyone the client wall lets in (branch head, delegate).
        // This used to demand rm_id === you, which refused people the client page
        // had just let in — the Service RM got "client not assigned to you" while
        // looking at the client.
        if (b.subjectType === "investor" && !seesAllInvestors) {
          let allowed = sr.rm_id === session.userId || sr.service_rm_id === session.userId;
          if (!allowed) {
            try {
              await assertCanViewClient(tx, session, {
                id: b.subjectId,
                rmId: sr.rm_id ?? null,
                serviceRmId: sr.service_rm_id ?? null,
              });
              allowed = true;
            } catch {
              allowed = false;
            }
          }
          if (!allowed) return { forbidden: true as const };
        }
        if (b.subjectType === "lead" && !seesAllLeads && sr.owner_id !== session.userId) {
          return { forbidden: true as const };
        }

        await tx.insert(activities).values({
          id,
          tenantId: session.tenantId,
          branchId: session.branchId ?? null,
          subjectType: b.subjectType,
          subjectId: b.subjectId,
          subjectName: sr.name ?? null,
          subjectPhone: sr.phone ?? null,
          kind: b.kind,
          direction: b.direction ?? null,
          status: b.status ?? null,
          subject: b.subject ?? null,
          notes: b.notes ?? null,
          occurredAt: b.occurredAt ? new Date(b.occurredAt) : new Date(),
          durationSec: b.durationSec ?? null,
          geoLat: b.geoLat != null ? String(b.geoLat) : null,
          geoLng: b.geoLng != null ? String(b.geoLng) : null,
          locationLabel: b.locationLabel ?? null,
          nextFollowupAt: b.nextFollowupAt ? new Date(b.nextFollowupAt) : null,
          ownerUserId: session.userId,
        } as any);

        await recordAudit(tx, {
          tenantId: session.tenantId,
          actorUserId: session.userId,
          action: "activity.create",
          entityType: "activity",
          entityId: id,
          after: { kind: b.kind, subjectType: b.subjectType, subjectId: b.subjectId } as any,
          ...meta,
        });
        if (b.subjectType === "investor") {
          await notifyClientTeam(tx, {
            tenantId: session.tenantId,
            investorId: b.subjectId,
            actorUserId: session.userId,
            kind: "client.meeting_note",
            title: "Meeting notes added for {client}",
            body: [b.subject, b.notes].filter(Boolean).join(" — ").slice(0, 240) || null,
          });
        }
        return { notFound: false as const };
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    if (result.notFound) return NextResponse.json({ error: "subject not found" }, { status: 404 });
    if ("forbidden" in result) return NextResponse.json({ error: "forbidden: client or lead not assigned to you" }, { status: 403 });
    return NextResponse.json({ id }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
