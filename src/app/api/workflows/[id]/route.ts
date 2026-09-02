import { handleApiError } from "@/lib/api/error-handler";
/**
 * Single-workflow endpoints.
 *
 *   GET    /api/workflows/[id]   — read workflow + current version graph
 *   PATCH  /api/workflows/[id]   — update name/desc/enabled/category
 *   DELETE /api/workflows/[id]   — soft-delete (set enabled=false; hard delete only on empty)
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { workflows, workflowVersions } from "@/db/schema";
import { setTriggersEnabled } from "@/lib/workflow/triggers";

export const dynamic = "force-dynamic";

const Patch = z.object({
  name: z.string().min(2).max(120).optional(),
  description: z.string().max(2000).optional(),
  enabled: z.boolean().optional(),
  category: z.string().optional(),
  recurrencePolicy: z.string().optional(),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    const row = await withTenant(session.tenantId, async (tx) => {
      const wf = await tx
        .select()
        .from(workflows)
        .where(and(eq(workflows.id, id), eq(workflows.tenantId, session.tenantId)))
        .limit(1);
      if (!wf.length) return null;
      const ver = wf[0].currentVersionId
        ? await tx
            .select()
            .from(workflowVersions)
            .where(
              and(
                eq(workflowVersions.id, wf[0].currentVersionId!),
                eq(workflowVersions.tenantId, session.tenantId)
              )
            )
            .limit(1)
        : [];
      return { workflow: wf[0], version: ver[0] ?? null };
    });
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(row);
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "workflow.edit", session.permissions);
    const parse = Patch.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

    const result = await withTenant(session.tenantId, async (tx) => {
      const r = await tx
        .update(workflows)
        .set({ ...parse.data, updatedAt: new Date() } as any)
        .where(and(eq(workflows.id, id), eq(workflows.tenantId, session.tenantId)))
        .returning();
      // Keep the workflow's triggers in lockstep with its enabled flag so a
      // disabled workflow never fires (and re-enabling resumes it).
      if (r[0] && parse.data.enabled !== undefined) {
        await setTriggersEnabled(tx, id, parse.data.enabled, session.tenantId);
      }
      return r[0] ?? null;
    });
    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "workflow.edit", session.permissions);
    await withTenant(session.tenantId, async (tx) => {
      await tx
        .update(workflows)
        .set({ enabled: false, pausedReason: "deleted", pausedAt: new Date() } as any)
        .where(and(eq(workflows.id, id), eq(workflows.tenantId, session.tenantId)));
      // Stop the workflow firing once soft-deleted.
      await setTriggersEnabled(tx, id, false, session.tenantId);
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
