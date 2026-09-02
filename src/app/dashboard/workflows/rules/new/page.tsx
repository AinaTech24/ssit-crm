import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { RuleBuilder } from "@/components/workflow-rules/RuleBuilderLazy";
import { MODULES } from "@/lib/workflow-rules/modules";

export const dynamic = "force-dynamic";

export default async function NewRulePage() {
  const session = await requireSession();
  if (!can(session.roles, "workflow.edit", session.permissions)) redirect("/dashboard/workflows/rules");

  return (
    <RuleBuilder
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
