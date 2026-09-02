import { handleApiError } from "@/lib/api/error-handler";
/**
 * Workflow version endpoints.
 *
 *   POST   /api/workflows/[id]/versions          — save a new draft version (graph)
 *   POST   /api/workflows/[id]/versions/publish  — publish the latest draft
 *
 * Versions are immutable. Editing creates a new draft; in-flight runs continue
 * on the version they started with.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { and, desc, eq, max } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { workflows, workflowVersions } from "@/db/schema";
import { validateGraph } from "@/lib/workflow/schema";

export const dynamic = "force-dynamic";

const SaveBody = z.object({ graph: z.any() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "workflow.edit", session.permissions);
    const parse = SaveBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

    const validation = validateGraph(parse.data.graph);
    if (!validation.ok) {
      return NextResponse.json({ error: "invalid graph", issues: validation.issues }, { status: 400 });
    }

    const result = await withTenant(session.tenantId, async (tx) => {
      // Either update existing draft or create a new draft version.
      const existingDraft = await tx
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

      if (existingDraft.length) {
        const updated = await tx
          .update(workflowVersions)
          .set({ graph: parse.data.graph, validationReport: validation, updatedAt: new Date() } as any)
          .where(
            and(
              eq(workflowVersions.id, existingDraft[0].id),
              eq(workflowVersions.tenantId, session.tenantId)
            )
          )
          .returning();
        return { versionId: updated[0].id, action: "updated", versionNumber: updated[0].versionNumber };
      }

      // Find next version number
      const maxRow = await tx
        .select({ v: max(workflowVersions.versionNumber) })
        .from(workflowVersions)
        .where(
          and(
            eq(workflowVersions.workflowId, id),
            eq(workflowVersions.tenantId, session.tenantId)
          )
        );
      const nextVersion = (maxRow[0]?.v ?? 0) + 1;

      const versionId = uuid();
      await tx.insert(workflowVersions).values({
        id: versionId,
        workflowId: id,
        tenantId: session.tenantId,
        versionNumber: nextVersion,
        status: "draft",
        graph: parse.data.graph,
        validationReport: validation,
      } as any);

      return { versionId, action: "created", versionNumber: nextVersion };
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
