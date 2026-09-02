import { handleApiError } from "@/lib/api/error-handler";
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { assignmentRules } from "@/db/schema";

export const dynamic = "force-dynamic";
const isManager = (roles: string[]) => roles.some((r) => ["owner", "branch_head"].includes(r));
const Patch = z.object({ isActive: z.boolean().optional(), priority: z.number().int().optional() });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    if (!isManager(session.roles)) return NextResponse.json({ error: "not allowed" }, { status: 403 });
    const parse = Patch.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const row = await withTenant(session.tenantId, async (tx) =>
      (await tx.update(assignmentRules).set({ ...parse.data, updatedAt: new Date() } as any).where(and(eq(assignmentRules.id, id), eq(assignmentRules.tenantId, session.tenantId))).returning())[0]);
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ rule: row });
  } catch (err: any) { return handleApiError(err); }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    if (!isManager(session.roles)) return NextResponse.json({ error: "not allowed" }, { status: 403 });
    await withTenant(session.tenantId, async (tx) => tx.delete(assignmentRules).where(and(eq(assignmentRules.id, id), eq(assignmentRules.tenantId, session.tenantId))));
    return NextResponse.json({ ok: true });
  } catch (err: any) { return handleApiError(err); }
}
