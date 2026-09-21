import { handleApiError } from "@/lib/api/error-handler";
import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { and, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can, requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { createNotification } from "@/lib/notifications/create";
import { tasks, users, investors, leads } from "@/db/schema";

export const dynamic = "force-dynamic";

const DEPARTMENTS = [
  "sales",
  "operations",
  "back_office",
  "compliance",
  "marketing",
  "advisory",
  "support",
  "leadership",
  "other",
] as const;

const Body = z.object({
  title: z.string().min(2).max(300),
  description: z.string().optional(),
  type: z.string().default("follow_up"),
  subjectType: z
    .enum(["investor", "lead", "folio", "transaction", "family", "service_request", "compliance", "internal"])
    .default("internal"),
  subjectId: z.string().uuid().optional(),
  /** Module 18 — explicit related-entity ids (any combination). */
  relatedInvestorId: z.string().uuid().optional(),
  relatedLeadId: z.string().uuid().optional(),
  relatedServiceRequestId: z.string().uuid().optional(),
  relatedMeetingId: z.string().uuid().optional(),
  department: z.enum(DEPARTMENTS).optional(),
  remarks: z.string().max(1000).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  /** Initial status — lets the Kanban quick-add drop a card straight into a
   *  column. Defaults to 'open' for the normal create flow. */
  status: z.enum(["open", "in_progress", "blocked", "completed", "cancelled"]).default("open"),
  assigneeId: z.string().uuid().optional(),
  dueAt: z.string().optional(),
  /** Recurrence — null/omitted = one-off. */
  recurrence: z.enum(["daily", "weekly", "monthly", "quarterly", "yearly"]).optional(),
  recurrenceUntil: z.string().optional(), // YYYY-MM-DD
  /** Approval loop — when true, the assignee submits for sign-off instead of
   *  completing directly (creator / owner approves or reopens). */
  requiresApproval: z.boolean().optional(),
  /** Per-task reminder — absolute ISO time to ping the assignee. */
  remindAt: z.string().optional(),
  /** Planned effort in minutes (time tracking). */
  estimateMinutes: z.number().int().min(0).max(100000).optional(),
  /** Free-form tags. */
  tags: z.array(z.string().min(1).max(40)).max(30).optional(),
  /** Action points (checklist) — optional at creation; stored in meta.checklist. */
  checklist: z
    .array(z.object({ id: z.string().max(64), text: z.string().min(1).max(500), done: z.boolean() }))
    .max(100)
    .optional(),
  /** Back-office classification (Finowise MIS) — stored in meta for the
   *  Back-Office Work report. */
  boParticular: z
    .enum(["purchase_rectified", "sip_rectified", "nj_redemption", "nj_wecare_switch", "pms"])
    .optional(),
  boChannel: z.enum(["online", "offline"]).optional(),
  boValue: z.number().min(0).max(1e12).optional(),
});

/**
 * Default SLA window by priority (hours from creation). The SLA stat + badges
 * were dead because nothing set slaDueAt on manual tasks — this gives every task
 * an internal response target so "SLA at risk" / breach surfacing actually works.
 * A workflow or the editor can still override slaDueAt explicitly.
 */
const SLA_HOURS_BY_PRIORITY: Record<string, number> = { urgent: 4, high: 24, normal: 72, low: 168 };

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["task.view.all", "task.view.assigned"], session.permissions);
    const canViewAll = can(session.roles, "task.view.all", session.permissions);

    const url = new URL(req.url);
    const g = (k: string) => url.searchParams.get(k) ?? "";
    const csv = (v: string) => v.split(",").filter(Boolean);
    const q = g("q").trim();
    const statusFilter = csv(g("status"));
    const priorityFilter = csv(g("priority"));
    const typeFilter = csv(g("type"));
    const deptFilter = csv(g("department"));
    const assigneeFilter = csv(g("assignee"));
    const due = g("due"); // today | overdue | sla_risk
    const approval = g("approval"); // "" | pending | mine  (awaiting sign-off)
    const view = g("view"); // "" | to_me | by_me | kanban
    const isKanban = view === "kanban";
    const sortKey = (["created", "created_asc", "due", "due_desc", "priority"] as const).includes(g("sort") as any) ? g("sort") : "created";
    const createdFrom = g("created_from") || g("created");
    const createdTo = g("created_to") || g("created_end");
    const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
    const page = Math.max(1, Number(g("page") || "1") || 1);
    const PAGE_SIZE = 50;

    const result = await withTenant(
      session.tenantId,
      async (tx) => {
        const conds: any[] = [eq(tasks.tenantId, session.tenantId), isNull(tasks.deletedAt)];
        if (!canViewAll) conds.push(or(eq(tasks.assigneeId, session.userId), eq(tasks.createdById, session.userId))!);
        if (view === "to_me") conds.push(eq(tasks.assigneeId, session.userId));
        else if (view === "by_me") conds.push(eq(tasks.createdById, session.userId));
        // Kanban shows every status; the list defaults to open when no status
        // filter — UNLESS an approval filter is active (pending-approval tasks
        // are usually in_progress and would be hidden by the default-open rule).
        if (!isKanban) {
          if (statusFilter.length) conds.push(inArray(tasks.status, statusFilter as any));
          else if (!approval) conds.push(eq(tasks.status, "open"));
        } else if (statusFilter.length) conds.push(inArray(tasks.status, statusFilter as any));
        // Awaiting sign-off. `pending` = any task awaiting approval; `mine` =
        // ones this user is the approver for (its creator, or any if view-all).
        if (approval === "pending") conds.push(eq(tasks.approvalStatus, "pending"));
        else if (approval === "mine") {
          conds.push(eq(tasks.approvalStatus, "pending"));
          if (!canViewAll) conds.push(eq(tasks.createdById, session.userId));
        }
        if (q) conds.push(or(ilike(tasks.title, `%${q}%`), ilike(tasks.description, `%${q}%`), ilike(users.name, `%${q}%`))!);
        if (priorityFilter.length) conds.push(inArray(tasks.priority, priorityFilter as any));
        if (typeFilter.length) conds.push(inArray(tasks.type, typeFilter as any));
        if (deptFilter.length) conds.push(inArray(tasks.department, deptFilter as any));
        if (assigneeFilter.length) conds.push(inArray(tasks.assigneeId, assigneeFilter as any));
        if (due === "today") conds.push(sql`due_at::date = current_date`);
        else if (due === "overdue") conds.push(sql`due_at < now()`);
        else if (due === "sla_risk") conds.push(sql`sla_due_at IS NOT NULL AND sla_due_at < now() + interval '24 hours'`);
        if (isDate(createdFrom)) conds.push(sql`${tasks.createdAt} >= ${createdFrom}::date`);
        if (isDate(createdTo)) conds.push(sql`${tasks.createdAt} < (${createdTo}::date + interval '1 day')`);
        const where = and(...conds);

        const orderByExpr =
          sortKey === "priority"
            ? sql`case ${tasks.priority} when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end asc, ${tasks.dueAt} asc nulls last, ${tasks.createdAt} desc`
            : sortKey === "created" ? sql`${tasks.createdAt} desc`
            : sortKey === "created_asc" ? sql`${tasks.createdAt} asc`
            : sortKey === "due_desc" ? sql`${tasks.dueAt} desc nulls last, ${tasks.createdAt} desc`
            : sql`${tasks.dueAt} asc nulls last, ${tasks.createdAt} desc`;

        const totalRow = await tx.select({ c: sql<number>`count(*)::int` }).from(tasks).leftJoin(users, eq(users.id, tasks.assigneeId)).where(where as any);
        const rows = await tx
          .select({ task: tasks, assignee: users.name, investorName: investors.name, investorAvatarUrl: investors.avatarUrl, leadName: leads.name, leadAvatarUrl: leads.avatarUrl })
          .from(tasks)
          .leftJoin(users, eq(users.id, tasks.assigneeId))
          .leftJoin(investors, eq(investors.id, tasks.relatedInvestorId))
          .leftJoin(leads, eq(leads.id, tasks.relatedLeadId))
          .where(where as any)
          .orderBy(orderByExpr)
          .limit(isKanban ? 300 : PAGE_SIZE)
          .offset(isKanban ? 0 : (page - 1) * PAGE_SIZE);

        return {
          tasks: rows.map((r) => ({ ...r.task, assignee: r.assignee, investorName: r.investorName, investorAvatarUrl: r.investorAvatarUrl, leadName: r.leadName, leadAvatarUrl: r.leadAvatarUrl })),
          total: Number(totalRow[0]?.c ?? 0),
        };
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    return NextResponse.json({ tasks: result.tasks, total: result.total, page, limit: PAGE_SIZE });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["task.edit.all", "task.edit.assigned"], session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const body = parse.data;
    const meta = clientMetaFromHeaders(req.headers);

    // Users without task.edit.all may only create tasks assigned to themselves.
    const canEditAll = can(session.roles, "task.edit.all", session.permissions);
    const assigneeId = body.assigneeId ?? session.userId;
    if (!canEditAll && assigneeId !== session.userId) {
      return NextResponse.json({ error: "you can only assign tasks to yourself" }, { status: 403 });
    }

    const id = uuid();
    // Derive subjectType/subjectId from the first related entity if the caller
    // didn't set one explicitly — keeps legacy queries working.
    let derivedType = body.subjectType;
    let derivedId = body.subjectId ?? null;
    if (!body.subjectId) {
      if (body.relatedInvestorId) {
        derivedType = "investor";
        derivedId = body.relatedInvestorId;
      } else if (body.relatedLeadId) {
        derivedType = "lead";
        derivedId = body.relatedLeadId;
      } else if (body.relatedServiceRequestId) {
        derivedType = "service_request";
        derivedId = body.relatedServiceRequestId;
      } else if (body.relatedMeetingId) {
        derivedType = "internal";
        derivedId = body.relatedMeetingId;
      }
    }

    await withTenant(session.tenantId, async (tx) => {
      // Assignee must be a user in THIS tenant (the FK allows any tenant's user).
      const [u] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, assigneeId), eq(users.tenantId, session.tenantId)))
        .limit(1);
      if (!u) throw Object.assign(new Error("assignee not found in this firm"), { status: 400 });

      // Internal SLA target derived from priority (overridable later in the editor).
      const slaHours = SLA_HOURS_BY_PRIORITY[body.priority] ?? 72;
      const slaDueAt = new Date(Date.now() + slaHours * 60 * 60 * 1000);

      await tx.insert(tasks).values({
        id,
        tenantId: session.tenantId,
        subjectType: derivedType,
        subjectId: derivedId,
        relatedInvestorId: body.relatedInvestorId ?? null,
        relatedLeadId: body.relatedLeadId ?? null,
        relatedServiceRequestId: body.relatedServiceRequestId ?? null,
        relatedMeetingId: body.relatedMeetingId ?? null,
        department: body.department ?? null,
        type: body.type,
        title: body.title,
        description: body.description,
        remarks: body.remarks,
        priority: body.priority,
        status: body.status,
        assigneeId,
        createdById: session.userId,
        dueAt: body.dueAt ? new Date(body.dueAt) : null,
        slaDueAt,
        recurrence: body.recurrence ?? null,
        recurrenceUntil: body.recurrenceUntil ?? null,
        // Chain root = this task itself when recurring.
        recurrenceParentId: body.recurrence ? id : null,
        requiresApproval: body.requiresApproval ?? false,
        remindAt: body.remindAt ? new Date(body.remindAt) : null,
        estimateMinutes: body.estimateMinutes ?? null,
        ...(body.tags?.length ? { tags: body.tags } : {}),
        meta: (() => {
          const m: Record<string, unknown> = {};
          if (body.checklist?.length) m.checklist = body.checklist.map((c) => ({ ...c, done: false }));
          if (body.boParticular) m.boParticular = body.boParticular;
          if (body.boChannel) m.boChannel = body.boChannel;
          if (body.boValue != null) m.boValue = body.boValue;
          return Object.keys(m).length ? m : undefined;
        })(),
      } as any);

      // NOTE: tasks intentionally emit NO events_outbox row (task.created/updated).
      // Tasks are an OUTPUT of automations (the create_task workflow action), not a
      // trigger — wiring task.* into the outbox would risk automation loops
      // (a rule that creates a task firing a rule that reacts to tasks). The
      // workflow-rules `tasks` module catalog exists for future use, but is
      // deliberately dormant. Revisit only with explicit loop guards.
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "task.create",
        entityType: "task",
        entityId: id,
        after: { title: body.title, type: body.type, assigneeId, priority: body.priority } as any,
        ...meta,
      });

      // Notify the assignee when someone *else* assigns them a task (no self-ping).
      if (assigneeId !== session.userId) {
        const actor = (
          await tx.select({ name: users.name }).from(users).where(eq(users.id, session.userId)).limit(1)
        )[0];
        await createNotification(tx, {
          tenantId: session.tenantId,
          userId: assigneeId,
          kind: "task.assigned",
          title: `New task: ${body.title}`,
          body: actor?.name ? `${actor.name} assigned this task to you` : "A task was assigned to you",
          linkUrl: "/dashboard/tasks?view=assigned_to_me",
          severity: body.priority === "urgent" || body.priority === "high" ? "warning" : "info",
          meta: { task_id: id, assigned_by: session.userId, priority: body.priority },
        });
      }
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
