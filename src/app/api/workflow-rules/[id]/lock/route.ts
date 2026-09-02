import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { workflowRules } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  requireCap(session.roles, "workflow.edit", session.permissions);
  const { id } = await params;
  const body = await req.json().catch(() => ({} as any));
  const action = String(body.action ?? "lock"); // "lock" | "unlock"
  const reason = body.reason ? String(body.reason) : null;

  const out = await withTenant(session.tenantId, async (tx) => {
    const [current] = await tx
      .select()
      .from(workflowRules)
      .where(and(eq(workflowRules.id, id), eq(workflowRules.tenantId, session.tenantId)))
      .limit(1);
    if (!current) return { kind: "not_found" as const };

    // A rule locked by another admin can only be unlocked/relocked by that
    // admin (mirrors the PATCH edit guard) — prevents silently stealing a lock.
    if (current.locked && current.lockedBy && current.lockedBy !== session.userId) {
      return { kind: "locked_by_other" as const, by: current.lockedBy };
    }

    const [r] = await tx
      .update(workflowRules)
      .set(
        action === "unlock"
          ? { locked: false, lockReason: null, lockedBy: null, lockedAt: null, updatedAt: new Date() }
          : { locked: true, lockReason: reason, lockedBy: session.userId, lockedAt: new Date(), updatedAt: new Date() }
      )
      .where(and(eq(workflowRules.id, id), eq(workflowRules.tenantId, session.tenantId)))
      .returning();
    return { kind: "ok" as const, rule: r };
  });

  if (out.kind === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (out.kind === "locked_by_other")
    return NextResponse.json({ error: "This rule is locked by another user." }, { status: 423 });
  return NextResponse.json({ rule: out.rule });
}
