import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/workflow-rules/scheduled-jobs/retry-all — re-queue EVERY failed
 * scheduled rule job for the tenant at once (incident recovery). Resets each to
 * pending / attempts=0 / run_at=now() so the scheduler worker picks them up.
 * Conditional on status='failed'. Gated like the single retry (workflow.edit).
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { workflowRuleScheduledJobs } from "@/db/schema";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "workflow.edit", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const meta = clientMetaFromHeaders(req.headers);

    const count = await withTenant(session.tenantId, async (tx) => {
      const updated = await tx
        .update(workflowRuleScheduledJobs)
        .set({ status: "pending", lastError: null, attempts: 0, runAt: new Date(), updatedAt: new Date() } as any)
        .where(
          and(
            eq(workflowRuleScheduledJobs.tenantId, session.tenantId),
            eq(workflowRuleScheduledJobs.status, "failed")
          )
        )
        .returning({ id: workflowRuleScheduledJobs.id });
      const n = updated.length;
      if (n > 0) {
        await recordAudit(tx, {
          tenantId: session.tenantId,
          actorUserId: session.userId,
          action: "workflow_rule_job.retry_all",
          entityType: "workflow_rule_scheduled_job",
          entityId: session.tenantId,
          after: { requeued: n } as any,
          ...meta,
        });
      }
      return n;
    });

    return NextResponse.json({ ok: true, requeued: count });
  } catch (err: any) {
    return handleApiError(err);
  }
}
