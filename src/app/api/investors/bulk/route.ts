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
 *          = "field"    field = a key of BULK_FIELD_GROUPS, value = its value
 *                       → "Update a field": one catalogued field to the same value
 *
 * Tenant isolation is enforced by RLS (withTenant sets app.tenant_id) — we
 * scope by id only, exactly like the single-investor and leads/bulk routes.
 * Audited as a single bulk action.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { investors, users } from "@/db/schema";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { findBulkField } from "@/lib/investors/bulk-fields";

export const dynamic = "force-dynamic";

const Body = z.object({
  ids: z.array(z.string().uuid()).min(1).max(20000),
  action: z.enum(["assign", "review", "tier", "segment", "category", "field", "delete"]),
  value: z.string().nullable().optional(),
  /** For action "field": which catalogued field to set. */
  field: z.string().max(40).optional(),
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
    const { ids, action, value, field } = parsed.data;
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
      case "field": {
        const def = field ? findBulkField(field) : undefined;
        if (!def) return NextResponse.json({ error: "this field cannot be updated in bulk" }, { status: 400 });
        const v = (value ?? "").trim();
        if (def.kind === "select") {
          if (!def.options?.some((o) => o.value === v)) {
            return NextResponse.json({ error: `choose a valid ${def.label.toLowerCase()}` }, { status: 400 });
          }
          patch[def.column!] = v;
        } else if (def.kind === "date") {
          const d = new Date(v);
          if (!v || Number.isNaN(d.getTime())) return NextResponse.json({ error: "pick a valid date" }, { status: 400 });
          patch[def.column!] = d;
        } else if (def.kind === "text") {
          if (v.length > 120) return NextResponse.json({ error: "value is too long (max 120 characters)" }, { status: 400 });
          if (def.target === "address") {
            // Merge into the address object so the rest of the address is kept.
            patch.address = sql`COALESCE(${investors.address}, '{}'::jsonb) || ${JSON.stringify({ [def.key]: v })}::jsonb`;
          } else {
            patch[def.column!] = v === "" ? null : v;
          }
        } else if (def.kind === "tag_add" || def.kind === "tag_remove") {
          if (!v || v.length > 60) return NextResponse.json({ error: "enter a tag (up to 60 characters)" }, { status: 400 });
          if (def.kind === "tag_add") {
            // Case-insensitive de-dupe, capped at 25 like the single-client editor.
            patch.tags = sql`CASE
              WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(${investors.tags}, '[]'::jsonb)) t WHERE lower(t) = lower(${v}))
                OR jsonb_array_length(COALESCE(${investors.tags}, '[]'::jsonb)) >= 25
              THEN COALESCE(${investors.tags}, '[]'::jsonb)
              ELSE COALESCE(${investors.tags}, '[]'::jsonb) || to_jsonb(${v}::text)
            END`;
          } else {
            patch.tags = sql`COALESCE(
              (SELECT jsonb_agg(t) FROM jsonb_array_elements_text(COALESCE(${investors.tags}, '[]'::jsonb)) t WHERE lower(t) <> lower(${v})),
              '[]'::jsonb)`;
          }
        }
        break;
      }
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
        after: { action, field: field ?? null, value: value ?? null, count: updated.length, ids } as any,
        ...meta,
      });
      return updated.length;
    });

    return NextResponse.json({ ok: true, updated: count });
  } catch (err: any) {
    return handleApiError(err);
  }
}
