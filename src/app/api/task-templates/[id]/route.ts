import { handleApiError } from "@/lib/api/error-handler";
/**
 * PATCH  /api/task-templates/[id]  — partial update (subtasks replace wholesale)
 * DELETE /api/task-templates/[id]  — hard delete
 *
 * Both gated by `settings.users` (firm-admin cap) + an active license.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";

export const dynamic = "force-dynamic";

// Mirrors src/db/schema/tasks.ts (route files may only export route fields,
// so the sibling route.ts keeps its own copy).
const TASK_TEMPLATE_TASK_TYPES = [
  "follow_up",
  "review_meeting",
  "collect_document",
  "kyc_renewal",
  "custom",
] as const;

const TASK_TEMPLATE_DEPARTMENTS = [
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

const TASK_TEMPLATE_PRIORITIES = ["low", "normal", "high", "urgent"] as const;

const PatchBody = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
  taskType: z.enum(TASK_TEMPLATE_TASK_TYPES).nullable().optional(),
  department: z.enum(TASK_TEMPLATE_DEPARTMENTS).nullable().optional(),
  priority: z.enum(TASK_TEMPLATE_PRIORITIES).nullable().optional(),
  dueOffsetDays: z.number().int().min(0).max(365).nullable().optional(),
  subtasks: z
    .array(
      z.object({
        id: z.string().max(64).optional(),
        text: z.string().min(1).max(300),
      })
    )
    .max(50)
    .optional(),
  isActive: z.boolean().optional(),
});

const RETURNING = sql`
  RETURNING id, name, description, task_type, department, priority,
            due_offset_days, subtasks, is_active`;

function mapTemplateRow(r: Record<string, unknown>) {
  const subtasks = Array.isArray(r.subtasks)
    ? (r.subtasks as { id: string; text: string }[])
    : [];
  return {
    id: r.id as string,
    name: r.name as string,
    description: (r.description as string | null) ?? null,
    taskType: (r.task_type as string | null) ?? null,
    department: (r.department as string | null) ?? null,
    priority: (r.priority as string | null) ?? null,
    dueOffsetDays: (r.due_offset_days as number | null) ?? null,
    subtasks,
    isActive: r.is_active === true || r.is_active === "true",
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["task.view.all", "task.edit.all", "settings.users"], session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const { id } = await params;
    if (!UUID_RE.test(id))
      return NextResponse.json({ error: "not found" }, { status: 404 });

    const parse = PatchBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json(
        { error: "invalid body", issues: parse.error.issues },
        { status: 400 }
      );
    }
    const meta = clientMetaFromHeaders(req.headers);
    const body = parse.data;

    const sets: SQL[] = [sql`updated_at = now()`];
    if (body.name !== undefined) sets.push(sql`name = ${body.name.trim()}`);
    if (body.description !== undefined)
      sets.push(sql`description = ${body.description?.trim() || null}`);
    if (body.taskType !== undefined)
      sets.push(sql`task_type = ${body.taskType ?? null}`);
    if (body.department !== undefined)
      sets.push(sql`department = ${body.department ?? null}`);
    if (body.priority !== undefined)
      sets.push(sql`priority = ${body.priority ?? null}`);
    if (body.dueOffsetDays !== undefined)
      sets.push(sql`due_offset_days = ${body.dueOffsetDays ?? null}`);
    if (body.subtasks !== undefined) {
      // Wholesale replace — keep incoming ids (checklist references survive
      // an edit), mint fresh ones for newly-added items.
      const subtasks = body.subtasks.map((s) => ({
        id: s.id || crypto.randomUUID(),
        text: s.text.trim(),
      }));
      sets.push(sql`subtasks = ${JSON.stringify(subtasks)}::jsonb`);
    }
    if (body.isActive !== undefined) sets.push(sql`is_active = ${body.isActive}`);

    const result = await withTenant(
      session.tenantId,
      async (tx) => {
        const existingRes = await tx.execute(sql`
          SELECT id, name, description, task_type, department, priority,
                 due_offset_days, subtasks, is_active
          FROM task_templates
          WHERE id = ${id}::uuid AND tenant_id = ${session.tenantId}::uuid
        `);
        const existing = existingRes.rows[0] as Record<string, unknown> | undefined;
        if (!existing) return null;

        const updated = await tx.execute(sql`
          UPDATE task_templates
          SET ${sql.join(sets, sql`, `)}
          WHERE id = ${id}::uuid AND tenant_id = ${session.tenantId}::uuid
          ${RETURNING}
        `);
        const next = mapTemplateRow(updated.rows[0] as Record<string, unknown>);

        await recordAudit(tx, {
          tenantId: session.tenantId,
          actorUserId: session.userId,
          action: "task_template.update",
          entityType: "task_template",
          entityId: id,
          before: mapTemplateRow(existing),
          after: next,
          ...meta,
        });
        return next;
      },
      {
        userId: session.userId,
        branchId: session.branchId ?? undefined,
        roles: session.roles,
      }
    );

    if (!result)
      return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ template: result });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["task.view.all", "task.edit.all", "settings.users"], session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const { id } = await params;
    if (!UUID_RE.test(id))
      return NextResponse.json({ error: "not found" }, { status: 404 });
    const meta = clientMetaFromHeaders(req.headers);

    const found = await withTenant(
      session.tenantId,
      async (tx) => {
        const existingRes = await tx.execute(sql`
          SELECT id, name, description, task_type, department, priority,
                 due_offset_days, subtasks, is_active
          FROM task_templates
          WHERE id = ${id}::uuid AND tenant_id = ${session.tenantId}::uuid
        `);
        const existing = existingRes.rows[0] as Record<string, unknown> | undefined;
        if (!existing) return false;

        await tx.execute(sql`
          DELETE FROM task_templates
          WHERE id = ${id}::uuid AND tenant_id = ${session.tenantId}::uuid
        `);

        await recordAudit(tx, {
          tenantId: session.tenantId,
          actorUserId: session.userId,
          action: "task_template.delete",
          entityType: "task_template",
          entityId: id,
          before: mapTemplateRow(existing),
          after: null,
          ...meta,
        });
        return true;
      },
      {
        userId: session.userId,
        branchId: session.branchId ?? undefined,
        roles: session.roles,
      }
    );

    if (!found)
      return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
