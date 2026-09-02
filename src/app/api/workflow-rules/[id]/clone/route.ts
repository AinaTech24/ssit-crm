import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { workflowRules } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { isDuplicateNameError } from "@/lib/workflow-rules/guard";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { handleApiError } from "@/lib/api/error-handler";

export const dynamic = "force-dynamic";

function cloneName(name: string): string {
  // Strip the separators from the ISO timestamp -> "YYYYMMDDHHMM". We match
  // non-digits here rather than an explicit hyphen/colon/T character class:
  // that class literal gets mis-scanned by Tailwind's content scanner as a
  // utility and emits invalid CSS that breaks the Turbopack dev build.
  const stamp = new Date().toISOString().slice(0, 16).replace(/[^\d]/g, "");
  const base = `${name} Copy ${stamp}`;
  return base.length <= 120 ? base : base.slice(0, 120);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "workflow.edit", session.permissions);
    const { id } = await params;
    const meta = clientMetaFromHeaders(req.headers);

    const out = await withTenant(session.tenantId, async (tx) => {
      const [source] = await tx
        .select()
        .from(workflowRules)
        .where(and(eq(workflowRules.id, id), eq(workflowRules.tenantId, session.tenantId)));
      if (!source) return null;

      const [created] = await tx
        .insert(workflowRules)
        .values({
          tenantId: session.tenantId,
          module: source.module,
          name: cloneName(source.name),
          description: source.description,
          triggerType: source.triggerType,
          triggerConfig: source.triggerConfig,
          criteriaPattern: source.criteriaPattern,
          criteriaRows: source.criteriaRows,
          instantActions: source.instantActions,
          scheduledActions: source.scheduledActions,
          branches: source.branches,
          enabled: false,
          executionOrder: Number(source.executionOrder ?? 100) + 1,
          createdBy: session.userId,
        } as any)
        .returning();

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "workflow_rule.clone",
        entityType: "workflow_rule",
        entityId: created.id,
        before: { sourceRuleId: source.id, sourceName: source.name },
        after: { clonedRuleId: created.id, name: created.name, enabled: created.enabled },
        ...meta,
      });
      return created;
    });

    if (!out) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ rule: out }, { status: 201 });
  } catch (err: any) {
    if (isDuplicateNameError(err)) {
      return NextResponse.json({ error: "A cloned rule with this name already exists. Rename the existing copy first." }, { status: 409 });
    }
    return handleApiError(err);
  }
}
