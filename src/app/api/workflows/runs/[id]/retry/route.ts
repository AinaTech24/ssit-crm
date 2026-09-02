import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/workflows/runs/[id]/retry — re-queue a FAILED workflow run.
 *
 * The workflow-runner drains runs with status='queued' in a tight loop, so
 * "retry" simply transitions a failed run back to 'queued' and clears the
 * error/completion stamps. Handlers are idempotent (keyed on
 * runId+nodeId+attempt), so re-running is safe.
 *
 * Gated like other automation mutations (workflow.edit) + active licence.
 * Tenant isolation via RLS; scoped by id only.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { workflowRuns } from "@/db/schema";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** Loop guard — a deterministically-failing run can't be re-queued forever. */
const MAX_RETRIES = 5;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "workflow.edit", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const meta = clientMetaFromHeaders(req.headers);

    const out = await withTenant(session.tenantId, async (tx) => {
      // Conditional update: only a failed run under the retry cap is re-queued.
      const updated = await tx
        .update(workflowRuns)
        .set({
          status: "queued",
          error: null,
          completedAt: null,
          retryCount: sql`retry_count + 1`,
          updatedAt: new Date(),
        } as any)
        .where(
          and(
            eq(workflowRuns.id, id),
            eq(workflowRuns.status, "failed"),
            eq(workflowRuns.tenantId, session.tenantId),
            sql`retry_count < ${MAX_RETRIES}`
          )
        )
        .returning({ id: workflowRuns.id, retryCount: workflowRuns.retryCount });
      if (!updated.length) {
        // Distinguish "hit the retry cap" from "not found / not failed".
        const [cur] = await tx
          .select({ status: workflowRuns.status, retryCount: workflowRuns.retryCount })
          .from(workflowRuns)
          .where(and(eq(workflowRuns.id, id), eq(workflowRuns.tenantId, session.tenantId)))
          .limit(1);
        if (cur && cur.status === "failed" && (cur.retryCount ?? 0) >= MAX_RETRIES) return "capped" as const;
        return false as const;
      }
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "workflow_run.retry",
        entityType: "workflow_run",
        entityId: id,
        after: { requeued: true, retryCount: updated[0].retryCount } as any,
        ...meta,
      });
      return true as const;
    });

    if (out === "capped") {
      return NextResponse.json(
        { error: `Retry limit reached (${MAX_RETRIES}). This run fails deterministically — fix the workflow before retrying.` },
        { status: 409 }
      );
    }
    if (!out) {
      return NextResponse.json({ error: "run not found or not in failed state" }, { status: 409 });
    }
    return NextResponse.json({ ok: true, requeued: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
