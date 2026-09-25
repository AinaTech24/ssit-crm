import { handleApiError } from "@/lib/api/error-handler";
/**
 * Per-client gifts — single-gift endpoint.
 *
 *   PATCH  /api/investors/[id]/gifts/[giftId]   — edit a gift, and/or mark
 *                                                 delivered / undo
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
import { GIFT_CATEGORIES } from "@/lib/gifts/catalogue";
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

/**
 * Every field is OPTIONAL and only what is sent gets written.
 *
 * This used to accept `deliveredOn` alone, which made the route "mark
 * delivered" rather than "edit": a gift logged with the wrong amount, date or
 * title could only be deleted and re-added, losing its delivery state and its
 * place in the log. Partial updates also matter for correctness here — a PATCH
 * that edits the title must not blank `delivered_on` just because it didn't
 * mention it, which a fixed UPDATE would do.
 */
const PatchBody = z
  .object({
    occasion: z.enum(["birthday", "anniversary", "festival", "other"]).optional(),
    title: z.string().min(1).max(120).optional(),
    amount: z.number().int().min(0).optional(),
    givenOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected yyyy-mm-dd").optional(),
    notes: z.string().max(500).nullish(),
    // The engagement board logs and displays gifts as category + grade
    // ("Hamper · A"), so an edit started from there has to be able to change
    // them — otherwise the only editable fields would be ones that screen
    // doesn't show.
    category: z.enum(GIFT_CATEGORIES).nullish(),
    grade: z.string().max(4).nullish(),
    /** yyyy-mm-dd to mark delivered; null to undo. */
    deliveredOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "expected yyyy-mm-dd")
      .nullable()
      .optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "nothing to update" });

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
    const body = parse.data;
    const { deliveredOn } = body;

    const result = await withTenant(session.tenantId, async (tx) => {
      const invRes = await tx.execute(sql`
        SELECT branch_id, rm_id, service_rm_id FROM investors
        WHERE id = ${id}::uuid AND tenant_id = ${session.tenantId}::uuid
        LIMIT 1
      `);
      const inv = invRes.rows[0] as { branch_id: string | null; rm_id: string | null; service_rm_id: string | null } | undefined;
      if (!inv) return null;
      await assertInScope(tx, session, { branchId: inv.branch_id, ownerId: [inv.rm_id, inv.service_rm_id] }, "client");

      // Only the fields actually sent are written, so editing a title cannot
      // silently clear a delivery date (or the reverse).
      const sets = [sql`updated_at = now()`];
      if (body.occasion !== undefined) sets.push(sql`occasion = ${body.occasion}`);
      if (body.title !== undefined) sets.push(sql`title = ${body.title}`);
      if (body.amount !== undefined) sets.push(sql`amount = ${body.amount}`);
      if (body.givenOn !== undefined) sets.push(sql`given_on = ${body.givenOn}::date`);
      if (body.notes !== undefined) sets.push(sql`notes = ${body.notes ?? null}`);
      if (body.category !== undefined) sets.push(sql`category = ${body.category ?? null}`);
      if (body.grade !== undefined) sets.push(sql`grade = ${body.grade ?? null}`);
      if (body.deliveredOn !== undefined) sets.push(sql`delivered_on = ${deliveredOn}::date`);

      const upd = await tx.execute(sql`
        UPDATE client_gifts
           SET ${sql.join(sets, sql`, `)}
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
