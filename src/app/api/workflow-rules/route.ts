import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { workflowRules } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { WorkflowRuleSchema } from "@/lib/workflow-rules/types";
import { unsupportedRuleFeature, isDuplicateNameError } from "@/lib/workflow-rules/guard";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await requireSession();
  const { searchParams } = new URL(req.url);
  const moduleKey = searchParams.get("module");
  const enabled = searchParams.get("enabled");

  const rows = await withTenant(session.tenantId, async (tx) => {
    const conds: any[] = [eq(workflowRules.tenantId, session.tenantId)];
    if (moduleKey) conds.push(eq(workflowRules.module, moduleKey as any));
    if (enabled === "true") conds.push(eq(workflowRules.enabled, true));
    if (enabled === "false") conds.push(eq(workflowRules.enabled, false));

    const where = conds.length === 1 ? conds[0] : conds.length > 1 ? and(...conds) : undefined;
    return tx
      .select()
      .from(workflowRules)
      .where(where as any)
      .orderBy(workflowRules.module, workflowRules.executionOrder, desc(workflowRules.createdAt));
  });
  return NextResponse.json({ rules: rows });
}

export async function POST(req: NextRequest) {
  const session = await requireSession();
  requireCap(session.roles, "workflow.edit", session.permissions);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = WorkflowRuleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid rule", issues: parsed.error.flatten() }, { status: 400 });
  }
  const input = parsed.data;

  const unsupported = unsupportedRuleFeature(input as any);
  if (unsupported) return NextResponse.json({ error: unsupported }, { status: 400 });

  try {
    const row = await withTenant(session.tenantId, async (tx) => {
      const [created] = await tx
        .insert(workflowRules)
        .values({
          tenantId: session.tenantId,
          module: input.module as any,
          name: input.name,
          description: input.description ?? null,
          triggerType: input.triggerType,
          triggerConfig: input.triggerConfig,
          criteriaPattern: input.criteriaPattern ?? null,
          criteriaRows: input.criteriaRows as any,
          instantActions: input.instantActions as any,
          scheduledActions: input.scheduledActions as any,
          branches: input.branches as any,
          enabled: input.enabled,
          executionOrder: input.executionOrder,
          rateLimitPerHour: input.rateLimitPerHour ?? null,
          createdBy: session.userId,
        })
        .returning();
      return created;
    });
    return NextResponse.json({ rule: row }, { status: 201 });
  } catch (e: any) {
    if (isDuplicateNameError(e)) {
      return NextResponse.json({ error: "A rule with this name already exists in this module." }, { status: 409 });
    }
    throw e;
  }
}
