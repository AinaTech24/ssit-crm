import { handleApiError } from "@/lib/api/error-handler";
/**
 * Per-client gifts — single-gift endpoint.
 *
 *   PATCH  /api/investors/[id]/gifts/[giftId]   — mark delivered / undo
 *   DELETE /api/investors/[id]/gifts/[giftId]   — remove a gift
 *
 * Raw SQL inside withTenant(); RLS scopes by app.tenant_id and we filter by
 * tenant_id + investor_id + id as defence-in-depth.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { notifyGiftDelivered } from "@/lib/gifts/notify";
import { assertInScope } from "@/lib/auth/data-scope";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; giftId: string }> }
) {
  const { id, giftId } = await params;
  try {
    const session = await requireSession();
    // Client-linked write — same bar as editing the client record itself.
    requireAny(session.roles, ["investor.edit.all", "investor.edit.assigned", "gifting.manage"], session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    await withTenant(session.tenantId, async (tx) => {
      const invRes = await tx.execute(sql`
        SELECT branch_id, rm_id, service_rm_id FROM investors
        WHERE id = ${id}::uuid AND tenant_id = ${session.tenantId}::uuid
        LIMIT 1
      `);
      const inv = invRes.rows[0] as { branch_id: string | null; rm_id: string | null; service_rm_id: string | null } | undefined;
      if (inv) await assertInScope(tx, session, { branchId: inv.branch_id, ownerId: [inv.rm_id, inv.service_rm_id] }, "client");

      await tx.execute(sql`
        DELETE FROM client_gifts
        WHERE id = ${giftId}::uuid
          AND investor_id = ${id}::uuid
          AND tenant_id = ${session.tenantId}::uuid
      `);
      // Drop the intimation with the gift. Left behind it becomes a notice
      // about a gift that no longer exists — and re-adding the same gift then
      // reads as a duplicate notification.
      await tx.execute(sql`
        DELETE FROM notifications
        WHERE tenant_id = ${session.tenantId}::uuid
          AND kind IN ('gift.delivered', 'gift.anniversary')
          AND meta->>'giftId' = ${giftId}
      `);
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}

const PatchBody = z.object({
  /** yyyy-mm-dd to mark delivered; null to undo. */
  deliveredOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "expected yyyy-mm-dd")
    .nullable(),
});

/**
 * PATCH /api/investors/[id]/gifts/[giftId] — mark a gift delivered (or undo).
 *
 * Marking delivered intimates the client's owning RM, once. `rm_notified_at`
 * is the guard: a second PATCH, a retry, or an undo-then-redo will not send a
 * duplicate. Undoing clears the delivery date but deliberately KEEPS
 * rm_notified_at — the RM was genuinely told, and un-telling them is not a
 * thing; re-notifying for the same gift would just be noise.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; giftId: string }> }
) {
  const { id, giftId } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["investor.edit.all", "investor.edit.assigned", "gifting.manage"], session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);

    const parse = PatchBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const { deliveredOn } = parse.data;

    const result = await withTenant(session.tenantId, async (tx) => {
      const invRes = await tx.execute(sql`
        SELECT branch_id, rm_id, service_rm_id FROM investors
        WHERE id = ${id}::uuid AND tenant_id = ${session.tenantId}::uuid
        LIMIT 1
      `);
      const inv = invRes.rows[0] as { branch_id: string | null; rm_id: string | null; service_rm_id: string | null } | undefined;
      if (!inv) return null;
      await assertInScope(tx, session, { branchId: inv.branch_id, ownerId: [inv.rm_id, inv.service_rm_id] }, "client");

      const upd = await tx.execute(sql`
        UPDATE client_gifts
           SET delivered_on = ${deliveredOn}::date,
               updated_at = now()
         WHERE id = ${giftId}::uuid
           AND investor_id = ${id}::uuid
           AND tenant_id = ${session.tenantId}::uuid
        RETURNING id, title, amount, delivered_on, rm_notified_at
      `);
      if (upd.rows.length === 0) return null;
      const g = upd.rows[0] as {
        id: string;
        title: string;
        amount: number | string;
        delivered_on: string | null;
        rm_notified_at: string | null;
      };

      if (g.delivered_on && !g.rm_notified_at) {
        const invRes = await tx.execute(sql`
          SELECT name, rm_id FROM investors
          WHERE id = ${id}::uuid AND tenant_id = ${session.tenantId}::uuid
          LIMIT 1
        `);
        const inv = (invRes.rows[0] ?? {}) as { name?: string | null; rm_id?: string | null };
        const sent = await notifyGiftDelivered(tx, {
          tenantId: session.tenantId,
          rmId: inv.rm_id,
          giftId: giftId,
          investorId: id,
          clientName: inv.name ?? "this client",
          giftTitle: g.title,
          amount: Number(g.amount ?? 0),
          onDate: String(g.delivered_on).slice(0, 10),
        });
        if (sent) {
          await tx.execute(sql`
            UPDATE client_gifts SET rm_notified_at = now() WHERE id = ${giftId}::uuid
          `);
        }
      }

      return { id: g.id, deliveredOn: g.delivered_on ? String(g.delivered_on).slice(0, 10) : null };
    });

    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
