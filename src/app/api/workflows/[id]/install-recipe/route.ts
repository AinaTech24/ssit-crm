import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/recipes/[key]/install
 * Body: { name?: string }
 *
 * Clones a system recipe into the tenant as a new (disabled) workflow.
 * Owner reviews + enables in the editor.
 *
 * Routed at /api/workflows/[id]/install-recipe with [id]=recipe key for now;
 * cleaner home would be /api/recipes/[key]/install but Next path collision.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { workflows, workflowVersions } from "@/db/schema";
import { ALL_RECIPES } from "@/lib/recipes";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: recipeKey } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "workflow.edit", session.permissions);
    const recipe = ALL_RECIPES.find((r) => r.key === recipeKey);
    if (!recipe) return NextResponse.json({ error: "recipe not found" }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const name = (body.name as string | undefined)?.trim() || recipe.name;

    const wfId = uuid();
    const versionId = uuid();

    await withTenant(session.tenantId, async (tx) => {
      await tx.insert(workflows).values({
        id: wfId,
        tenantId: session.tenantId,
        name,
        description: recipe.description,
        category: recipe.category,
        recipeKey: recipe.key,
        enabled: false,
        currentVersionId: versionId,
        createdBy: session.userId,
      } as any);

      await tx.insert(workflowVersions).values({
        id: versionId,
        workflowId: wfId,
        tenantId: session.tenantId,
        versionNumber: 1,
        status: "draft",
        graph: recipe.graph,
      } as any);
    });

    return NextResponse.json({ id: wfId, versionId, name }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
