import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/workflows/[id]/publish
 *
 * Atomically:
 *   1. Marks the draft as published
 *   2. Archives the previously-published version
 *   3. Points workflows.current_version_id at the new published version
 *
 * In-flight workflow_runs continue on their original version (version_id
 * stamped on the run row).
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { workflows, workflowVersions } from "@/db/schema";
import { materializeTriggers } from "@/lib/workflow/triggers";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "workflow.publish", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);

    const clientMeta = clientMetaFromHeaders(req.headers);
    const result = await withTenant(session.tenantId, async (tx) => {
      const draft = await tx
        .select()
        .from(workflowVersions)
        .where(
          and(
            eq(workflowVersions.workflowId, id),
            eq(workflowVersions.status, "draft"),
            eq(workflowVersions.tenantId, session.tenantId)
          )
        )
        .limit(1);

      if (!draft.length) {
        throw Object.assign(new Error("no draft to publish"), { status: 400 });
      }

      // Archive previously-published versions
      await tx
        .update(workflowVersions)
        .set({ status: "archived" } as any)
        .where(
          and(
            eq(workflowVersions.workflowId, id),
            eq(workflowVersions.status, "published"),
            eq(workflowVersions.tenantId, session.tenantId)
          )
        );

      // Publish the draft
      await tx
        .update(workflowVersions)
        .set({
          status: "published",
          publishedAt: new Date(),
          publishedBy: session.userId,
        } as any)
        .where(
          and(
            eq(workflowVersions.id, draft[0].id),
            eq(workflowVersions.tenantId, session.tenantId)
          )
        );

      // Point the workflow at it
      await tx
        .update(workflows)
        .set({ currentVersionId: draft[0].id, enabled: true, pausedReason: null, pausedAt: null } as any)
        .where(and(eq(workflows.id, id), eq(workflows.tenantId, session.tenantId)));

      // Materialize the trigger row(s) from the published graph so the outbox
      // poller / master scheduler actually fire this workflow. Republish
      // replaces any prior trigger rows.
      await materializeTriggers(tx, {
        tenantId: session.tenantId,
        workflowId: id,
        graph: draft[0].graph,
        enabled: true,
      });

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "workflow.publish",
        entityType: "workflow",
        entityId: id,
        after: { versionId: draft[0].id, versionNumber: draft[0].versionNumber },
        ...clientMeta,
      });

      return { publishedVersionId: draft[0].id, versionNumber: draft[0].versionNumber };
    });
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
