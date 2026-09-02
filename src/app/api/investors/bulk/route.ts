import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/investors/bulk — apply one action to many clients at once.
 *
 * Body: { ids: string[], action, value? }
 *   action = "assign"   value = rmId (uuid) | null      → reassign RM
 *          = "review"   value = ISO date string         → set next review date
 *          = "tier"     value = "A" | "B" | "C"          → set service tier
 *          = "segment"  value = segment tag              → set segment
 *          = "category" value = "A" | "B" | "C" | "D"    → set client category
 *
 * Tenant isolation is enforced by RLS (withTenant sets app.tenant_id) — we
 * scope by id only, exactly like the single-investor and leads/bulk routes.
 * Audited as a single bulk action.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { investors, users } from "@/db/schema";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";

export const dynamic = "force-dynamic";

const Body = z.object({
  ids: z.array(z.string().uuid()).min(1).max(20000),
  action: z.enum(["assign", "review", "tier", "segment", "category", "delete"]),
  value: z.string().nullable().optional(),
});

const TIERS = new Set(["A", "B", "C"]);
const SEGMENTS = new Set(["HNI", "Affluent", "Retail", "NRI", "Corporate"]);
const CATEGORIES = new Set(["A", "B", "C", "D"]);

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    // Bulk reassign/retier/segment the book is a privileged mutation — gate it
    // exactly like the single-investor PATCH (investor.edit.all) instead of
    // letting any authenticated session through.
    requireCap(session.roles, "investor.edit.all", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const { ids, action, value } = parsed.data;
    // Permanent bulk erasure (up to 1000 clients + cascaded data) is far more
    // dangerous than a re-tag — gate it on the narrow delete capability, not the
    // broad edit.all this route otherwise runs on.
    if (action === "delete") requireCap(session.roles, "investor.delete", session.permissions);
    const meta = clientMetaFromHeaders(req.headers);

    const patch: Record<string, any> = { updatedAt: new Date() };
    switch (action) {
      case "assign":
        // Assigning to a stranger's uuid would orphan the clients under an RM
        // who can't see them — verify the target is a user in this firm.
        if (value && value.length > 0) {
          if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
            return NextResponse.json({ error: "assign value must be a user id" }, { status: 400 });
          }
          const exists = await withTenant(session.tenantId, async (tx) => {
            const [u] = await tx
              .select({ id: users.id })
              .from(users)
              .where(and(eq(users.id, value), eq(users.tenantId, session.tenantId)))
              .limit(1);
            return !!u;
          });
          if (!exists) return NextResponse.json({ error: "selected RM is not a user in this firm" }, { status: 400 });
          patch.rmId = value;
        } else {
          patch.rmId = null;
        }
        break;
      case "review":
        if (!value) return NextResponse.json({ error: "value (date) required" }, { status: 400 });
        patch.nextReviewAt = new Date(value);
        break;
      case "tier":
        if (!value || !TIERS.has(value)) {
          return NextResponse.json({ error: "value must be A, B or C" }, { status: 400 });
        }
        patch.serviceTier = value;
        break;
      case "segment":
        if (!value || !SEGMENTS.has(value)) {
          return NextResponse.json({ error: "invalid segment" }, { status: 400 });
        }
        patch.segmentTag = value;
        break;
      case "category":
        if (!value || !CATEGORIES.has(value)) {
          return NextResponse.json({ error: "value must be A, B, C or D" }, { status: 400 });
        }
        patch.clientCategory = value;
        break;
      case "delete":
        // Soft delete → Trash bin (recoverable). Stamped in the tx below; the
        // owned-data subgraph is preserved until the retention window elapses,
        // when daily-ops permanently purges it.
        break;
    }

    const count = await withTenant(session.tenantId, async (tx) => {
      // Tenant predicate (defense-in-depth) — a destructive bulk op must never
      // touch another firm's clients even if RLS is bypassed (superuser role).
      const scope = and(eq(investors.tenantId, session.tenantId), inArray(investors.id, ids));
      let updated: { id: string }[];
      if (action === "delete") {
        // Soft delete into the Trash bin — preserves all related data.
        updated = await tx
          .update(investors)
          .set({ deletedAt: new Date(), deletedBy: session.userId, updatedAt: new Date() } as any)
          .where(scope)
          .returning({ id: investors.id });
      } else {
        updated = await tx.update(investors).set(patch as any).where(scope).returning({ id: investors.id });
      }
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: `investor.bulk_${action}`,
        entityType: "investor",
        entityId: session.tenantId,
        after: { action, value: value ?? null, count: updated.length, ids } as any,
        ...meta,
      });
      return updated.length;
    });

    return NextResponse.json({ ok: true, updated: count });
  } catch (err: any) {
    return handleApiError(err);
  }
}
