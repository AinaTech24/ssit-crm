import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/macros/[id]/run — execute a macro's server-side steps against one
 * subject (lead/investor). Reuses our tasks + activities + lead-stage engines.
 * Body: { subjectType, subjectId }.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";

export const dynamic = "force-dynamic";
const Body = z.object({ subjectType: z.enum(["lead", "investor"]), subjectId: z.string().uuid() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    // Running a macro creates tasks/activities and can advance a lead's stage —
    // gate behind task/lead edit capability (audit: RBAC-ungated mutation).
    requireAny(
      session.roles,
      ["task.edit.all", "task.edit.assigned", "lead.edit.all", "lead.edit.assigned"],
      session.permissions
    );
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const { subjectType, subjectId } = parse.data;
    const meta = clientMetaFromHeaders(req.headers);

    const result = await withTenant(session.tenantId, async (tx) => {
      const macro = (await tx.execute(sql`SELECT name, steps, subject_type FROM macros WHERE id = ${id}::uuid AND tenant_id = ${session.tenantId}::uuid AND is_active = true LIMIT 1`)).rows[0] as any;
      if (!macro) return { error: "macro not found" as const };
      const subj = (await tx.execute(subjectType === "lead"
        ? sql`SELECT name, phone FROM leads WHERE id = ${subjectId}::uuid LIMIT 1`
        : sql`SELECT name, phone FROM investors WHERE id = ${subjectId}::uuid LIMIT 1`)).rows[0] as any;
      if (!subj) return { error: "subject not found" as const };

      const steps: Array<{ type: string; config: any }> = Array.isArray(macro.steps) ? macro.steps : [];
      let ran = 0;
      for (const step of steps) {
        const c = step.config ?? {};
        if (step.type === "create_task") {
          await tx.execute(sql`
            INSERT INTO tasks (id, tenant_id, type, title, priority, status, assignee_id, created_by_id, due_at, subject_type, subject_id, ${sql.raw(subjectType === "investor" ? "related_investor_id" : "related_lead_id")})
            VALUES (${uuid()}::uuid, ${session.tenantId}::uuid, 'custom', ${String(c.title ?? "Follow up").slice(0, 200)}, ${["low", "normal", "high", "urgent"].includes(c.priority) ? c.priority : "normal"}, 'open', ${session.userId}::uuid, ${session.userId}::uuid, ${c.dueInDays != null ? sql`now() + (${Number(c.dueInDays)} || ' days')::interval` : sql`NULL`}, ${subjectType}, ${subjectId}::uuid, ${subjectId}::uuid)`);
          ran++;
        } else if (step.type === "log_activity" || step.type === "add_note") {
          await tx.execute(sql`
            INSERT INTO activities (id, tenant_id, subject_type, subject_id, subject_name, subject_phone, kind, subject, notes, occurred_at, owner_user_id)
            VALUES (${uuid()}::uuid, ${session.tenantId}::uuid, ${subjectType}, ${subjectId}::uuid, ${subj.name ?? null}, ${subj.phone ?? null}, ${step.type === "add_note" ? "note" : (c.kind ?? "note")}, ${String(c.subject ?? (step.type === "add_note" ? "Note" : "Activity")).slice(0, 200)}, ${String(c.notes ?? c.text ?? "").slice(0, 4000) || null}, now(), ${session.userId}::uuid)`);
          ran++;
        } else if (step.type === "advance_stage" && subjectType === "lead" && c.stage) {
          await tx.execute(sql`UPDATE leads SET stage = ${String(c.stage)}, updated_at = now() WHERE id = ${subjectId}::uuid AND tenant_id = ${session.tenantId}::uuid`);
          ran++;
        } else if (step.type === "set_followup" && subjectType === "lead") {
          await tx.execute(sql`UPDATE leads SET next_follow_up_at = now() + (${Number(c.days ?? 2)} || ' days')::interval, updated_at = now() WHERE id = ${subjectId}::uuid AND tenant_id = ${session.tenantId}::uuid`);
          ran++;
        }
      }
      await recordAudit(tx, { tenantId: session.tenantId, actorUserId: session.userId, action: "macro.run", entityType: "macro", entityId: id, after: { subjectType, subjectId, ran } as any, ...meta });
      return { ok: true as const, ran };
    });
    const errMsg = "error" in result ? result.error : null;
    if (errMsg) return NextResponse.json({ error: errMsg }, { status: 404 });
    return NextResponse.json(result);
  } catch (err: any) { return handleApiError(err); }
}
