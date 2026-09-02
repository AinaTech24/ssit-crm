import { NextRequest, NextResponse } from "next/server";
import { and, asc, desc, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { workflowRules } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { handleApiError } from "@/lib/api/error-handler";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "workflow.edit", session.permissions);
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const direction = body?.direction === "down" ? "down" : "up";
    const meta = clientMetaFromHeaders(req.headers);

    const out = await withTenant(session.tenantId, async (tx) => {
      const [rule] = await tx
        .select()
        .from(workflowRules)
        .where(and(eq(workflowRules.id, id), eq(workflowRules.tenantId, session.tenantId)));
      if (!rule) return null;

      const moduleRules = await tx
        .select()
        .from(workflowRules)
        .where(and(eq(workflowRules.tenantId, session.tenantId), eq(workflowRules.module, rule.module)))
        .orderBy(asc(workflowRules.executionOrder), desc(workflowRules.createdAt));

      const from = moduleRules.findIndex((r) => r.id === id);
      const to = direction === "up" ? from - 1 : from + 1;
      if (from < 0 || to < 0 || to >= moduleRules.length) {
        return { moved: false };
      }

      const reordered = [...moduleRules];
      const [item] = reordered.splice(from, 1);
      reordered.splice(to, 0, item);

      for (let i = 0; i < reordered.length; i++) {
        await tx
          .update(workflowRules)
          .set({ executionOrder: (i + 1) * 10, updatedAt: new Date() })
          .where(and(eq(workflowRules.id, reordered[i].id), eq(workflowRules.tenantId, session.tenantId)));
      }

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "workflow_rule.reorder",
        entityType: "workflow_rule",
        entityId: id,
        before: { index: from, executionOrder: rule.executionOrder },
        after: { index: to, direction },
        ...meta,
      });

      return { moved: true };
    });

    if (!out) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(out);
  } catch (err) {
    return handleApiError(err);
  }
}
