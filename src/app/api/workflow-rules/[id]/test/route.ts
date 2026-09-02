/**
 * Dry-run tester for a Workflow Rule — nothing executes, nothing is logged.
 *
 *   GET  /api/workflow-rules/[id]/test
 *        → the 20 most recent records of the rule's module (id + display name)
 *          so the UI can offer a picker.
 *
 *   POST /api/workflow-rules/[id]/test   { subjectId }
 *        → evaluates the rule's condition branches against that record and
 *          returns which branch (if any) would match and exactly which
 *          instant + scheduled actions WOULD fire.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { workflowRules } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { getModule } from "@/lib/workflow-rules/modules";
import { resolveBranch, effectiveBranches } from "@/lib/workflow-rules/runner";
import { handleApiError } from "@/lib/api/error-handler";

export const dynamic = "force-dynamic";

/** Best display column for the record picker, validated against the catalog. */
function displayField(moduleKey: string): string {
  const mod = getModule(moduleKey);
  const keys = new Set((mod?.fields ?? []).map((f) => f.key));
  for (const candidate of ["name", "title", "subject", "family_name", "head_name"]) {
    if (keys.has(candidate)) return candidate;
  }
  return "id";
}

async function loadRule(tx: any, tenantId: string, id: string) {
  const [rule] = await tx
    .select()
    .from(workflowRules)
    .where(and(eq(workflowRules.id, id), eq(workflowRules.tenantId, tenantId)));
  return rule ?? null;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "workflow.edit", session.permissions);
    const { id } = await params;

    const out = await withTenant(session.tenantId, async (tx) => {
      const rule = await loadRule(tx, session.tenantId, id);
      if (!rule) return null;
      const mod = getModule(rule.module);
      if (!mod) return { records: [] };
      const nameCol = displayField(rule.module);
      const res = await tx.execute(sql`
        SELECT id, ${sql.raw(`"${nameCol}"`)} AS display
        FROM ${sql.raw(`"${mod.table}"`)}
        WHERE tenant_id = ${session.tenantId}::uuid
        ORDER BY created_at DESC
        LIMIT 20
      `);
      return {
        records: (res.rows as Array<{ id: string; display: unknown }>).map((r) => ({
          id: r.id,
          name: String(r.display ?? r.id),
        })),
      };
    });
    if (!out) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(out);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "workflow.edit", session.permissions);
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const subjectId = String(body?.subjectId ?? "");
    if (!subjectId) return NextResponse.json({ error: "subjectId required" }, { status: 400 });

    const out = await withTenant(session.tenantId, async (tx) => {
      const rule = await loadRule(tx, session.tenantId, id);
      if (!rule) return null;
      const mod = getModule(rule.module);
      if (!mod) return { error: "Unknown module" };

      const res = await tx.execute(sql`
        SELECT * FROM ${sql.raw(`"${mod.table}"`)}
        WHERE tenant_id = ${session.tenantId}::uuid AND id = ${subjectId}::uuid
        LIMIT 1
      `);
      const record = (res.rows[0] ?? null) as Record<string, unknown> | null;
      if (!record) return { error: "Record not found" };

      const branch = resolveBranch(rule, record);
      const totalBranches = effectiveBranches(rule).length;
      if (!branch) {
        return {
          matched: false,
          totalBranches,
          message: "This record does not match any condition — the rule would NOT fire for it.",
        };
      }
      const branchName = branch.name ?? (branch.idx === 0 ? "Main conditions" : `Condition ${branch.idx + 1}`);

      return {
        matched: true,
        totalBranches,
        branchIndex: branch.idx,
        branchName,
        wouldRunInstant: branch.instantActions.map((a) => ({ type: a.type, label: a.label })),
        wouldQueueScheduled: branch.scheduledActions.map((a) => ({
          type: a.type,
          label: a.label,
          delay: a.delay,
        })),
        note:
          rule.triggerType === "record_action"
            ? "Conditions evaluated against the record's current values. The create/edit trigger gate itself isn't simulated."
            : undefined,
      };
    });
    if (!out) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if ((out as any).error) return NextResponse.json(out, { status: 400 });
    return NextResponse.json(out);
  } catch (err) {
    return handleApiError(err);
  }
}
