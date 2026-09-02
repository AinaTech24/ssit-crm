import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { workflowRules } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { getModule } from "@/lib/workflow-rules/modules";
import { fireRuleOnRecordTx } from "@/lib/workflow-rules/runner";
import { handleApiError } from "@/lib/api/error-handler";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "workflow.edit", session.permissions);
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const subjectId = String(body?.subjectId ?? "");
    if (!subjectId) return NextResponse.json({ error: "subjectId required" }, { status: 400 });

    const out = await withTenant(session.tenantId, async (tx) => {
      const [rule] = await tx
        .select()
        .from(workflowRules)
        .where(and(eq(workflowRules.id, id), eq(workflowRules.tenantId, session.tenantId)));
      if (!rule) return null;
      if (!rule.enabled) return { error: "Rule is disabled. Enable it before running it manually." };

      const mod = getModule(rule.module);
      if (!mod) return { error: "Unknown module" };

      const res = await tx.execute(sql`
        SELECT * FROM ${sql.raw(`"${mod.table}"`)}
        WHERE tenant_id = ${session.tenantId}::uuid AND id = ${subjectId}::uuid
        LIMIT 1
      `);
      const record = (res.rows[0] ?? null) as Record<string, unknown> | null;
      if (!record) return { error: "Record not found" };

      const result = await fireRuleOnRecordTx(tx, rule, {
        subjectType: mod.entityType,
        subjectId,
        record,
        eventId: null,
        triggeredBy: "manual",
      });

      return {
        matched: result.matched,
        reason: result.reason,
        branchIndex: result.branchIndex,
        branchName: result.branchName,
        instantOutcomes: result.instantOutcomes,
        scheduledQueued: result.scheduledQueued,
      };
    });

    if (!out) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if ((out as any).error) return NextResponse.json(out, { status: 400 });
    return NextResponse.json(out);
  } catch (err) {
    return handleApiError(err);
  }
}
