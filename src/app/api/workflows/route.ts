import { handleApiError } from "@/lib/api/error-handler";
/**
 * Workflow collection endpoints.
 *
 *   GET  /api/workflows           — list workflows in the tenant
 *   POST /api/workflows           — create a new workflow + draft version 1
 *
 * Single-workflow endpoints are at /api/workflows/[id]/route.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { workflows, workflowVersions } from "@/db/schema";
import { validateGraph } from "@/lib/workflow/schema";

export const dynamic = "force-dynamic";

const CreateBody = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(2000).optional(),
  category: z.enum(["compliance", "retention", "onboarding", "marketing", "operations", "internal", "service", "custom"]).default("custom"),
  graph: z.any(),
  recipeKey: z.string().optional(),
});

export async function GET() {
  try {
    const session = await requireSession();
    const rows = await withTenant(session.tenantId, async (tx) => {
      return tx
        .select()
        .from(workflows)
        .where(eq(workflows.tenantId, session.tenantId))
        .orderBy(desc(workflows.updatedAt));
    });
    return NextResponse.json({ workflows: rows });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "workflow.edit", session.permissions);
    const parse = CreateBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const body = parse.data;

    // Validate the graph before persisting — never let a bad graph land in the DB.
    const validation = validateGraph(body.graph);
    if (!validation.ok) {
      return NextResponse.json({ error: "invalid graph", issues: validation.issues }, { status: 400 });
    }

    const wfId = uuid();
    const versionId = uuid();

    const result = await withTenant(session.tenantId, async (tx) => {
      await tx.insert(workflows).values({
        id: wfId,
        tenantId: session.tenantId,
        name: body.name,
        description: body.description,
        category: body.category,
        recipeKey: body.recipeKey,
        enabled: false, // start disabled — owner explicitly turns on after review
        createdBy: session.userId,
      } as any);

      await tx.insert(workflowVersions).values({
        id: versionId,
        workflowId: wfId,
        tenantId: session.tenantId,
        versionNumber: 1,
        status: "draft",
        graph: body.graph,
        validationReport: validation,
      } as any);

      // Point workflow at the draft version (so the canvas can load it).
      await tx
        .update(workflows)
        .set({ currentVersionId: versionId })
        .where(and(eq(workflows.id, wfId), eq(workflows.tenantId, session.tenantId)));

      return { id: wfId, versionId };
    }, { userId: session.userId, branchId: session.branchId, roles: session.roles });

    return NextResponse.json(result, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
