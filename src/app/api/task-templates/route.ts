import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET  /api/task-templates  — list the tenant's task templates
 *                             (active only by default; `?all=1` includes inactive)
 * POST /api/task-templates  — create one
 *
 * Templates are predefined tasks with sub-task checklists (SOPs like
 * "New client onboarding" → collect docs → KYC → UCC → mandate) the team
 * applies from the New Task form.
 *
 * Reads need only a session (any team member picks a template when creating a
 * task); writes are gated by `settings.users` (firm-admin territory).
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";

export const dynamic = "force-dynamic";

// NOTE: route files may only export Next.js route fields — keep these local.
// (The [id] route keeps its own copy; the values mirror src/db/schema/tasks.ts.)
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

const PostBody = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  taskType: z.enum(TASK_TEMPLATE_TASK_TYPES).optional(),
  department: z.enum(TASK_TEMPLATE_DEPARTMENTS).optional(),
  priority: z.enum(TASK_TEMPLATE_PRIORITIES).optional(),
  dueOffsetDays: z.number().int().min(0).max(365).optional(),
  subtasks: z
    .array(z.object({ text: z.string().min(1).max(300) }))
    .max(50)
    .default([]),
  isActive: z.boolean().default(true),
});

/** Map a raw pg row to the camelCased API shape. */
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

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const all = req.nextUrl.searchParams.get("all") === "1";

    const rows = await withTenant(
      session.tenantId,
      async (tx) => {
        const r = await tx.execute(sql`
          SELECT id, name, description, task_type, department, priority,
                 due_offset_days, subtasks, is_active
          FROM task_templates
          WHERE tenant_id = ${session.tenantId}::uuid
            ${all ? sql`` : sql`AND is_active = true`}
          ORDER BY is_active DESC, name ASC
        `);
        return r.rows as Record<string, unknown>[];
      },
      {
        userId: session.userId,
        branchId: session.branchId ?? undefined,
        roles: session.roles,
      }
    );

    return NextResponse.json({ templates: rows.map(mapTemplateRow) });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["task.view.all", "task.edit.all", "settings.users"], session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);

    const parse = PostBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json(
        { error: "invalid body", issues: parse.error.issues },
        { status: 400 }
      );
    }
    const meta = clientMetaFromHeaders(req.headers);
    const data = parse.data;

    // Server-assigned sub-task ids — stable across edits, referenced by the
    // task checklist when the template is applied.
    const subtasks = data.subtasks.map((s) => ({
      id: crypto.randomUUID(),
      text: s.text.trim(),
    }));

    const created = await withTenant(
      session.tenantId,
      async (tx) => {
        const r = await tx.execute(sql`
          INSERT INTO task_templates
            (tenant_id, name, description, task_type, department, priority,
             due_offset_days, subtasks, is_active, created_by)
          VALUES
            (${session.tenantId}::uuid,
             ${data.name.trim()},
             ${data.description?.trim() || null},
             ${data.taskType ?? null},
             ${data.department ?? null},
             ${data.priority ?? null},
             ${data.dueOffsetDays ?? null},
             ${JSON.stringify(subtasks)}::jsonb,
             ${data.isActive},
             ${session.userId}::uuid)
          RETURNING id, name, description, task_type, department, priority,
                    due_offset_days, subtasks, is_active
        `);
        const row = mapTemplateRow(r.rows[0] as Record<string, unknown>);

        await recordAudit(tx, {
          tenantId: session.tenantId,
          actorUserId: session.userId,
          action: "task_template.create",
          entityType: "task_template",
          entityId: row.id,
          before: null,
          after: row,
          ...meta,
        });
        return row;
      },
      {
        userId: session.userId,
        branchId: session.branchId ?? undefined,
        roles: session.roles,
      }
    );

    return NextResponse.json({ template: created });
  } catch (err: any) {
    return handleApiError(err);
  }
}
