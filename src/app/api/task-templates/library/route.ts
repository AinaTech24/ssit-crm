import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET  /api/task-templates/library  — the researched MFD SOP catalog + which
 *                                      entries are already installed (by name).
 * POST /api/task-templates/library  — install catalog entries into the tenant's
 *                                      task_templates. Body: { keys?: string[] }
 *                                      (omit to install ALL). Idempotent: entries
 *                                      whose name already exists are skipped.
 * Writes gated by settings.users (firm-admin).
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { MFD_TASK_TEMPLATE_LIBRARY } from "@/lib/tasks/mfd-template-library";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireSession();
    const existing = await withTenant(
      session.tenantId,
      async (tx) => {
        const r = await tx.execute(sql`SELECT lower(name) AS name FROM task_templates WHERE tenant_id = ${session.tenantId}::uuid`);
        return new Set((r.rows as { name: string }[]).map((x) => x.name));
      },
      { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles }
    );
    const catalog = MFD_TASK_TEMPLATE_LIBRARY.map((t) => ({
      key: t.key,
      name: t.name,
      description: t.description,
      group: t.group,
      taskType: t.taskType,
      department: t.department,
      priority: t.priority,
      dueOffsetDays: t.dueOffsetDays,
      subtasks: t.subtasks,
      installed: existing.has(t.name.toLowerCase()),
    }));
    return NextResponse.json({ catalog });
  } catch (err: any) {
    return handleApiError(err);
  }
}

const PostBody = z.object({ keys: z.array(z.string()).max(100).optional() });

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.users", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = PostBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

    const wanted = parse.data.keys && parse.data.keys.length > 0 ? new Set(parse.data.keys) : null;
    const picks = MFD_TASK_TEMPLATE_LIBRARY.filter((t) => (wanted ? wanted.has(t.key) : true));
    const meta = clientMetaFromHeaders(req.headers);

    const result = await withTenant(
      session.tenantId,
      async (tx) => {
        const r = await tx.execute(sql`SELECT lower(name) AS name FROM task_templates WHERE tenant_id = ${session.tenantId}::uuid`);
        const existing = new Set((r.rows as { name: string }[]).map((x) => x.name));

        let added = 0;
        const skipped: string[] = [];
        for (const t of picks) {
          if (existing.has(t.name.toLowerCase())) {
            skipped.push(t.name);
            continue;
          }
          const subtasks = t.subtasks.map((text) => ({ id: crypto.randomUUID(), text }));
          await tx.execute(sql`
            INSERT INTO task_templates
              (tenant_id, name, description, task_type, department, priority,
               due_offset_days, subtasks, is_active, created_by)
            VALUES
              (${session.tenantId}::uuid, ${t.name}, ${t.description}, ${t.taskType},
               ${t.department}, ${t.priority}, ${t.dueOffsetDays},
               ${JSON.stringify(subtasks)}::jsonb, true, ${session.userId}::uuid)
          `);
          existing.add(t.name.toLowerCase());
          added += 1;
        }

        if (added > 0) {
          await recordAudit(tx, {
            tenantId: session.tenantId,
            actorUserId: session.userId,
            action: "task_template.library_install",
            entityType: "task_template",
            entityId: null,
            before: null,
            after: { added, skipped: skipped.length } as any,
            ...meta,
          });
        }
        return { added, skipped };
      },
      { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles }
    );

    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
