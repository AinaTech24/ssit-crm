/**
 * Task Templates designer — the firm owner defines predefined tasks with
 * sub-task checklists (SOPs like "New client onboarding" → collect docs →
 * KYC → UCC → mandate). The team applies them from the New Task form.
 */

import Link from "next/link";
import { ChevronLeft, ListChecks } from "lucide-react";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import {
  TaskTemplatesManager,
  type TaskTemplateRow,
} from "@/components/settings/TaskTemplatesManager";

export const dynamic = "force-dynamic";

export default async function TaskTemplatesPage() {
  const session = await requireSession();
  // Task templates are firm-wide task SOPs — manageable by task managers
  // (edit-all) or firm admins (user-management cap), not gated behind user mgmt.
  requireAny(session.roles, ["task.view.all", "task.edit.all", "settings.users"], session.permissions);

  const templates = await withTenant(
    session.tenantId,
    async (tx) => {
      const r = await tx.execute(sql`
        SELECT id, name, description, task_type, department, priority,
               due_offset_days, subtasks, is_active
        FROM task_templates
        WHERE tenant_id = ${session.tenantId}::uuid
        ORDER BY is_active DESC, name ASC
      `);
      return (r.rows as Record<string, unknown>[]).map(
        (row): TaskTemplateRow => ({
          id: row.id as string,
          name: row.name as string,
          description: (row.description as string | null) ?? null,
          taskType: (row.task_type as string | null) ?? null,
          department: (row.department as string | null) ?? null,
          priority: (row.priority as string | null) ?? null,
          dueOffsetDays: (row.due_offset_days as number | null) ?? null,
          subtasks: Array.isArray(row.subtasks)
            ? (row.subtasks as { id: string; text: string }[])
            : [],
          isActive: row.is_active === true || row.is_active === "true",
        })
      );
    },
    {
      userId: session.userId,
      branchId: session.branchId ?? undefined,
      roles: session.roles,
    }
  );

  return (
    <div className="space-y-4 max-w-4xl">
      <Link
        href="/dashboard/settings"
        className="text-sm text-muted-foreground hover:underline flex items-center gap-1"
      >
        <ChevronLeft className="size-4" /> Back to settings
      </Link>

      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <ListChecks className="size-5" /> Task templates
        </h1>
        <p className="text-muted-foreground text-sm">
          Predefined tasks with sub-task checklists — your team applies them
          from the New Task form.
        </p>
      </div>

      <TaskTemplatesManager templates={templates} />
    </div>
  );
}
