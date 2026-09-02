import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/business-entries/bulk — apply one action to many entries at once.
 *
 * Body: { ids: string[], action, value? }
 *   action = "status"   value = draft|confirmed|emailed|cancelled
 *          = "assign"   value = userId (uuid) — reassigns the RM
 *          = "delete"   (no value) → SOFT-cancel (status='cancelled'); the
 *                        revenue row + its audit trail are preserved
 *
 * RBAC: same manage roles as the single-entry route; RMs are scoped to the
 * entries they booked. Tenant-scoped via RLS.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { businessEntries, eventsOutbox, users } from "@/db/schema";
import { BUSINESS_ENTRY_STATUSES } from "@/db/schema/business_entries";

export const dynamic = "force-dynamic";

const MANAGE_ROLES = ["owner", "branch_head", "rm", "back_office", "ops"];
const canManage = (roles: string[]) => roles.some((r) => MANAGE_ROLES.includes(r));
/** Managers/ops act on any entry; an RM only on the entries they booked. */
const seesAllEntries = (s: { roles: string[]; permissions?: string[] | null }) =>
  can(s.roles, "investor.view.all", s.permissions) || can(s.roles, "reports.business", s.permissions);

const Body = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  action: z.enum(["status", "assign", "delete"]),
  value: z.string().nullable().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    if (!canManage(session.roles)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    await assertActiveLicense(session.tenantId, session.roles);
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const { ids, action, value } = parsed.data;
    const meta = clientMetaFromHeaders(req.headers);

    const count = await withTenant(session.tenantId, async (tx) => {
      // Scope: RMs may only act on the entries they booked.
      const conds: any[] = [eq(businessEntries.tenantId, session.tenantId), inArray(businessEntries.id, ids)];
      if (!seesAllEntries(session)) conds.push(eq(businessEntries.rmId, session.userId));
      const where = and(...conds);

      const patch: Record<string, any> = { updatedAt: new Date() };
      if (action === "delete") {
        // Soft-cancel — void the booking but keep the revenue row + audit trail.
        patch.status = "cancelled";
      } else if (action === "status") {
        if (!value || !(BUSINESS_ENTRY_STATUSES as readonly string[]).includes(value)) {
          throw Object.assign(new Error("invalid status"), { status: 400 });
        }
        patch.status = value;
      } else if (action === "assign") {
        if (!value) throw Object.assign(new Error("value (userId) required"), { status: 400 });
        const [u] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, value), eq(users.tenantId, session.tenantId)))
          .limit(1);
        if (!u) throw Object.assign(new Error("RM not found in this firm"), { status: 400 });
        patch.rmId = value;
      }
      const upd = await tx.update(businessEntries).set(patch).where(where).returning({ id: businessEntries.id });
      const n = upd.length;

      // A status change (incl. a cancel) is a record edit the workflow rules may
      // react to (e.g. draft → confirmed fires the client confirmation). Emit
      // business_entry.updated per affected row, matching the single PATCH. An
      // assign doesn't touch a field the rules key on, so skip it there.
      if ((action === "status" || action === "delete") && n > 0) {
        const affectedIds = upd.map((u) => u.id);
        const snaps = await tx
          .select({
            id: businessEntries.id,
            investorId: businessEntries.investorId,
            clientName: businessEntries.clientName,
            productType: businessEntries.productType,
            status: businessEntries.status,
            totalAmount: businessEntries.totalAmount,
            amcName: businessEntries.amcName,
            platform: businessEntries.platform,
            rmId: businessEntries.rmId,
            businessDate: businessEntries.businessDate,
          })
          .from(businessEntries)
          .where(and(eq(businessEntries.tenantId, session.tenantId), inArray(businessEntries.id, affectedIds)));
        await tx.insert(eventsOutbox).values(
          snaps.map((e) => ({
            tenantId: session.tenantId,
            kind: "business_entry.updated",
            entityType: "business_entry",
            entityId: e.id,
            after: {
              id: e.id,
              investor_id: e.investorId ?? null,
              client_name: e.clientName,
              product_type: e.productType,
              status: e.status,
              total_amount: e.totalAmount,
              amc_name: e.amcName ?? null,
              platform: e.platform ?? null,
              rm_id: e.rmId ?? null,
              business_date: e.businessDate,
            } as any,
            meta: { userId: session.userId, source: `bulk_${action}` } as any,
          })) as any
        );
      }

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: `business_entry.bulk_${action}`,
        entityType: "business_entry",
        entityId: ids[0],
        after: { ids, action, value: value ?? null, count: n } as any,
        ...meta,
      }).catch(() => {});

      return n;
    });

    return NextResponse.json({ ok: true, count });
  } catch (err: any) {
    return handleApiError(err);
  }
}
