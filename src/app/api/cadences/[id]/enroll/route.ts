import { handleApiError } from "@/lib/api/error-handler";
/** POST /api/cadences/[id]/enroll — enroll a lead/client into a cadence. */
import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";

export const dynamic = "force-dynamic";
const Body = z.object({ subjectType: z.enum(["lead", "investor"]), subjectId: z.string().uuid() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    // Enrolling a lead/client into an outbound cadence is a sales action —
    // gate behind lead/client edit capability (audit: RBAC-ungated mutation).
    requireAny(
      session.roles,
      ["lead.edit.all", "lead.edit.assigned", "investor.edit.all", "investor.edit.assigned"],
      session.permissions
    );
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const { subjectType, subjectId } = parse.data;

    const result = await withTenant(session.tenantId, async (tx) => {
      const cad = (await tx.execute(sql`SELECT steps FROM cadences WHERE id = ${id}::uuid AND tenant_id = ${session.tenantId}::uuid AND is_active = true LIMIT 1`)).rows[0] as any;
      if (!cad) return { error: "cadence not found" as const };
      const subj = (await tx.execute(subjectType === "lead"
        ? sql`SELECT name FROM leads WHERE id = ${subjectId}::uuid LIMIT 1`
        : sql`SELECT name FROM investors WHERE id = ${subjectId}::uuid LIMIT 1`)).rows[0] as any;
      if (!subj) return { error: "subject not found" as const };
      const existing = (await tx.execute(sql`SELECT id FROM cadence_enrollments WHERE tenant_id = ${session.tenantId}::uuid AND cadence_id = ${id}::uuid AND subject_id = ${subjectId}::uuid AND status = 'active' LIMIT 1`)).rows[0];
      if (existing) return { error: "already enrolled" as const };
      const steps: any[] = Array.isArray(cad.steps) ? cad.steps : [];
      const firstOffset = steps.length ? Number(steps[0].dayOffset || 0) : 0;
      const enrollId = uuid();
      await tx.execute(sql`
        INSERT INTO cadence_enrollments (id, tenant_id, cadence_id, subject_type, subject_id, subject_name, current_step, status, next_run_at, enrolled_by_user_id)
        VALUES (${enrollId}::uuid, ${session.tenantId}::uuid, ${id}::uuid, ${subjectType}, ${subjectId}::uuid, ${subj.name ?? null}, 0, 'active', now() + (${firstOffset} || ' days')::interval, ${session.userId}::uuid)`);
      return { ok: true as const, enrollId };
    });
    const errMsg = "error" in result ? result.error : null;
    if (errMsg) return NextResponse.json({ error: errMsg }, { status: errMsg.includes("not found") ? 404 : 409 });
    return NextResponse.json(result);
  } catch (err: any) { return handleApiError(err); }
}
