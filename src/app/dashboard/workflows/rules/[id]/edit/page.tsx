import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { workflowRules } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { RuleBuilder } from "@/components/workflow-rules/RuleBuilderLazy";
import { MODULES } from "@/lib/workflow-rules/modules";

export const dynamic = "force-dynamic";

export default async function EditRulePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!can(session.roles, "workflow.edit", session.permissions)) redirect("/dashboard/workflows/rules");
  const { id } = await params;

  const rule = await withTenant(session.tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(workflowRules)
      .where(and(eq(workflowRules.id, id), eq(workflowRules.tenantId, session.tenantId)));
    return row ?? null;
  });
  if (!rule) notFound();

  return (
    <RuleBuilder
      mode="edit"
      initialRule={{
        id: rule.id,
        module: rule.module,
        name: rule.name,
        description: rule.description,
        triggerType: rule.triggerType,
        triggerConfig: (rule.triggerConfig ?? {}) as any,
        criteriaPattern: rule.criteriaPattern,
        criteriaRows: (rule.criteriaRows ?? []) as any,
        instantActions: (rule.instantActions ?? []) as any,
        scheduledActions: (rule.scheduledActions ?? []) as any,
        branches: ((rule as any).branches ?? []) as any,
      }}
      modules={Object.values(MODULES).map((m) => ({
        key: m.key,
        label: m.label,
        fields: m.fields.map((f) => ({
          key: f.key,
          label: f.label,
          type: f.type,
          writable: !!f.writable,
          dateAnchor: !!f.dateAnchor,
          scoreField: !!f.scoreField,
          enumValues: f.enumValues ?? null,
        })),
      }))}
    />
  );
}
