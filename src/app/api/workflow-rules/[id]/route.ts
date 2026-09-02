import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { workflowRules } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { WorkflowRuleSchema } from "@/lib/workflow-rules/types";
import { unsupportedRuleFeature, isDuplicateNameError } from "@/lib/workflow-rules/guard";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const row = await withTenant(session.tenantId, async (tx) => {
    const [r] = await tx.select().from(workflowRules).where(and(eq(workflowRules.id, id), eq(workflowRules.tenantId, session.tenantId)));
    return r;
  });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ rule: row });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  requireCap(session.roles, "workflow.edit", session.permissions);
  const { id } = await params;
  const meta = clientMetaFromHeaders(req.headers);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Allow partial updates — use WorkflowRuleSchema.partial()
  const parsed = WorkflowRuleSchema.partial().safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 400 });
  }
  const updates = parsed.data;

  let row: any;
  try {
    row = await withTenant(session.tenantId, async (tx) => {
      const existing = await tx.select().from(workflowRules).where(and(eq(workflowRules.id, id), eq(workflowRules.tenantId, session.tenantId)));
      if (!existing[0]) return null;
      if (existing[0].locked && existing[0].lockedBy !== session.userId) {
        return { __locked: true };
      }

      const merged = {
        triggerType: updates.triggerType ?? existing[0].triggerType,
        criteriaPattern: updates.criteriaPattern !== undefined ? updates.criteriaPattern : existing[0].criteriaPattern,
        criteriaRows: updates.criteriaRows !== undefined ? updates.criteriaRows : existing[0].criteriaRows,
        instantActions: updates.instantActions !== undefined ? updates.instantActions : existing[0].instantActions,
        scheduledActions: updates.scheduledActions !== undefined ? updates.scheduledActions : existing[0].scheduledActions,
        branches: updates.branches !== undefined ? updates.branches : existing[0].branches,
      };
      const unsupported = unsupportedRuleFeature(merged as any);
      if (unsupported) return { __validationError: unsupported };

      const next: any = {};
      if (updates.name !== undefined) next.name = updates.name;
      if (updates.description !== undefined) next.description = updates.description;
      if (updates.triggerType !== undefined) next.triggerType = updates.triggerType;
      if (updates.triggerConfig !== undefined) next.triggerConfig = updates.triggerConfig;
      if (updates.criteriaPattern !== undefined) next.criteriaPattern = updates.criteriaPattern;
      if (updates.criteriaRows !== undefined) next.criteriaRows = updates.criteriaRows;
      if (updates.instantActions !== undefined) next.instantActions = updates.instantActions;
      if (updates.scheduledActions !== undefined) next.scheduledActions = updates.scheduledActions;
      if (updates.branches !== undefined) next.branches = updates.branches;
      if (updates.enabled !== undefined) next.enabled = updates.enabled;
      if (updates.executionOrder !== undefined) next.executionOrder = updates.executionOrder;
      if (updates.rateLimitPerHour !== undefined) next.rateLimitPerHour = updates.rateLimitPerHour;
      next.updatedAt = new Date();

      const [r] = await tx.update(workflowRules).set(next).where(and(eq(workflowRules.id, id), eq(workflowRules.tenantId, session.tenantId))).returning();
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "workflow_rule.update",
        entityType: "workflow_rule",
        entityId: id,
        before: existing[0],
        after: r,
        ...meta,
      });
      return r;
    });
  } catch (e: any) {
    if (isDuplicateNameError(e)) {
      return NextResponse.json({ error: "A rule with this name already exists in this module." }, { status: 409 });
    }
    throw e;
  }
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if ((row as any).__locked) return NextResponse.json({ error: "Rule is locked" }, { status: 423 });
  if ((row as any).__validationError) return NextResponse.json({ error: (row as any).__validationError }, { status: 400 });
  return NextResponse.json({ rule: row });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  requireCap(session.roles, "workflow.edit", session.permissions);
  const { id } = await params;
  const meta = clientMetaFromHeaders(req.headers);

  const deleted = await withTenant(session.tenantId, async (tx) => {
    const [before] = await tx.select().from(workflowRules).where(and(eq(workflowRules.id, id), eq(workflowRules.tenantId, session.tenantId)));
    if (!before) return false;
    await tx.delete(workflowRules).where(and(eq(workflowRules.id, id), eq(workflowRules.tenantId, session.tenantId)));
    await recordAudit(tx, {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      action: "workflow_rule.delete",
      entityType: "workflow_rule",
      entityId: id,
      before,
      after: null,
      ...meta,
    });
    return true;
  });
  if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
