import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/workflow-rules/scheduled-jobs/[id]/retry — re-queue a FAILED
 * scheduled rule job from the Automation Monitor.
 *
 * Resets the job to 'pending' with attempts=0 and run_at=now() so the rules
 * scheduler worker picks it up on its next tick. Conditional on status='failed'
 * (returns 409 otherwise) so a concurrent run/double-click can't disturb a
 * live job. Gated like other automation mutations (workflow.edit) + licence.
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "workflow.edit", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    // Validate the id shape so a malformed value returns a clean 400 rather than
    // a 500 on the uuid cast (parity with the outbox-retry route's bigint guard).
    if (!UUID_RE.test(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
    const meta = clientMetaFromHeaders(req.headers);

    const out = await withTenant(session.tenantId, async (tx) => {
      const updated = await tx
        .update(workflowRuleScheduledJobs)
        .set({ status: "pending", lastError: null, attempts: 0, runAt: new Date(), updatedAt: new Date() } as any)
        .where(
          and(
            eq(workflowRuleScheduledJobs.id, id),
            eq(workflowRuleScheduledJobs.status, "failed"),
            eq(workflowRuleScheduledJobs.tenantId, session.tenantId)
          )
        )
        .returning({ id: workflowRuleScheduledJobs.id });
      if (!updated.length) return false;
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "workflow_rule_job.retry",
        entityType: "workflow_rule_scheduled_job",
        entityId: id,
        after: { requeued: true } as any,
        ...meta,
      });
      return true;
    });

    if (!out) return NextResponse.json({ error: "job not found or not in failed state" }, { status: 409 });
    return NextResponse.json({ ok: true, requeued: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
