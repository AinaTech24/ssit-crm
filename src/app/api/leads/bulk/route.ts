import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/leads/bulk — apply one action to many leads at once.
 *
 * Body: { ids: string[], action, value? }
 *   action = "assign"     value = ownerId (uuid) | null   → reassign RM
 *          = "follow_up"  value = ISO date string         → set next follow-up
 *          = "stage"      value = stage key               → move stage (override)
 *          = "lost"       value = lost reason (optional)  → mark not_qualified
 *          = "delete"     (no value)                      → soft-delete (hidden)
 *
 * Tenant-scoped via withTenant + RLS; only leads in the caller's tenant are
 * touched. Audited as a single bulk action.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { leads, users, eventsOutbox } from "@/db/schema";
import { scoreFields } from "@/lib/leads/score";
import { CANONICAL_LEAD_STAGES } from "@/lib/leads/normalize";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const dynamic = "force-dynamic";

const Body = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  action: z.enum(["assign", "follow_up", "stage", "lost", "delete"]),
  value: z.string().nullable().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    // Bulk acts on arbitrary lead ids (no per-row ownership re-check), so it's a
    // manager-level capability — RMs do single-lead edits via their own routes.
    requireCap(session.roles, "lead.edit.all", session.permissions);
    // A lapsed tenant must not be able to mutate the pipeline in bulk (the
    // single-lead PATCH already enforces this; bulk skipped it).
    await assertActiveLicense(session.tenantId, session.roles);
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const { ids, action, value } = parsed.data;
    const meta = clientMetaFromHeaders(req.headers);

    const patch: Record<string, any> = { updatedAt: new Date() };
    switch (action) {
      case "assign":
        if (value && value.length > 0) {
          if (!UUID_RE.test(value)) {
            return NextResponse.json({ error: "assign value must be a user id" }, { status: 400 });
          }
          // Assigning to an out-of-tenant uuid would orphan the leads under an
          // owner who can't see them — verify the target is a user in this firm.
          const exists = await withTenant(session.tenantId, async (tx) => {
            const [u] = await tx
              .select({ id: users.id })
              .from(users)
              .where(and(eq(users.id, value), eq(users.tenantId, session.tenantId)))
              .limit(1);
            return !!u;
          });
          if (!exists) return NextResponse.json({ error: "selected owner is not a user in this firm" }, { status: 400 });
          patch.ownerId = value;
        } else {
          patch.ownerId = null;
        }
        break;
      case "follow_up":
        if (!value) return NextResponse.json({ error: "value (date) required" }, { status: 400 });
        patch.nextFollowUpAt = new Date(value);
        break;
      case "stage":
        if (!value) return NextResponse.json({ error: "value (stage) required" }, { status: 400 });
        // Guard the enum: a raw arbitrary stage would violate the column check
        // (500) or store garbage. Only canonical stage keys are accepted.
        if (!(CANONICAL_LEAD_STAGES as readonly string[]).includes(value)) {
          return NextResponse.json({ error: "invalid stage" }, { status: 400 });
        }
        patch.stage = value;
        patch.stageChangedAt = new Date();
        break;
      case "lost":
        patch.stage = "not_qualified";
        patch.lostAt = new Date();
        patch.lostReason = value || "Bulk-marked not qualified";
        break;
      case "delete":
        // Mirror the single-lead DELETE: soft-delete with the __deleted__
        // sentinel so these leads are HIDDEN from every list / kanban / KPI
        // (filtered out), not dumped into the genuine "Not qualified" bucket.
        patch.stage = "not_qualified";
        patch.stageChangedAt = new Date();
        patch.lostAt = new Date();
        patch.lostReason = "__deleted__";
        patch.deletedAt = new Date();
        patch.deletedBy = session.userId;
        break;
    }

    const count = await withTenant(session.tenantId, async (tx) => {
      // Tenant isolation is enforced by RLS (withTenant sets app.tenant_id);
      // matching the single-lead route convention — scope by id only, never
      // add a redundant tenant_id predicate. RLS guarantees only the caller's
      // tenant's leads are visible/updatable.
      const updated = await tx
        .update(leads)
        .set(patch as any)
        .where(inArray(leads.id, ids))
        .returning({ id: leads.id });

      // Re-score affected leads when the action changed a scoring input (stage,
      // follow-up momentum, or marking lost). Owner reassignment doesn't move
      // the score, so we skip the recompute there.
      if (action === "stage" || action === "lost" || action === "follow_up") {
        const touchedIds = updated.map((u) => u.id);
        if (touchedIds.length) {
          const rows = await tx.select().from(leads).where(inArray(leads.id, touchedIds));
          for (const l of rows) {
            const sf = scoreFields({
              source: l.source,
              stage: l.stage,
              intendedAmount: l.intendedAmount,
              lastContactAt: l.lastContactAt,
              nextFollowUpAt: l.nextFollowUpAt,
              stageChangedAt: l.stageChangedAt,
              email: l.email,
              phone: l.phone,
              pan: l.pan,
              interestProducts: l.interestProducts,
            });
            await tx.update(leads).set(sf as any).where(eq(leads.id, l.id));
          }
        }
      }

      // Emit lead.updated per affected lead so record_action "edit" workflow
      // rules fire on bulk changes too (not just on /won + single edits). The
      // after-snapshot is the post-update row; before is omitted — bulk is a
      // coarse admin action, not a field-level change worth diffing.
      const finalIds = updated.map((u) => u.id);
      if (finalIds.length) {
        const finalRows = await tx.select().from(leads).where(inArray(leads.id, finalIds));
        await tx.insert(eventsOutbox).values(
          finalRows.map((l) => ({
            tenantId: session.tenantId,
            kind: action === "delete" ? "lead.deleted" : "lead.updated",
            entityType: "lead",
            entityId: l.id,
            after: l as any,
            meta: { userId: session.userId, source: `bulk_${action}` } as any,
          })) as any
        );
      }

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: `lead.bulk_${action}`,
        entityType: "lead",
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
