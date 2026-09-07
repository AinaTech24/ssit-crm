import { handleApiError } from "@/lib/api/error-handler";
/**
 * Per-client gifts & budget — collection endpoint.
 *
 *   GET  /api/investors/[id]/gifts   — dob, budget, spent, gift log
 *   POST /api/investors/[id]/gifts   — add a gift
 *   PUT  /api/investors/[id]/gifts   — set the birthday-gift budget
 *
 * All reads/writes go through RAW SQL inside withTenant() — there is no Drizzle
 * schema for client_gifts (see migration 0159). RLS scopes rows by app.tenant_id;
 * we also filter by tenant_id + investor_id as defence-in-depth.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { notifyGiftDelivered } from "@/lib/gifts/notify";

export const dynamic = "force-dynamic";

const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected yyyy-mm-dd");

const AddBody = z.object({
  occasion: z.enum(["birthday", "anniversary", "festival", "other"]).default("birthday"),
  title: z.string().min(1).max(120),
  amount: z.number().int().min(0).default(0),
  givenOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected yyyy-mm-dd"),
  notes: z.string().max(500).optional(),
  /** Set when the gift has already reached the client — intimates the RM. */
  deliveredOn: DateStr.nullish(),
});

const BudgetBody = z.object({
  budget: z.number().int().min(0).nullable(),
});

function mapGift(r: any) {
  return {
    id: r.id as string,
    occasion: r.occasion as string,
    title: r.title as string,
    amount: Number(r.amount ?? 0),
    givenOn: r.given_on as string,
    deliveredOn: (r.delivered_on as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    createdAt: r.created_at as string,
  };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    const result = await withTenant(session.tenantId, async (tx) => {
      const invRes = await tx.execute(sql`
        SELECT dob, birthday_gift_budget AS budget
        FROM investors
        WHERE id = ${id}::uuid AND tenant_id = ${session.tenantId}::uuid
        LIMIT 1
      `);
      const inv = invRes.rows[0];
      if (!inv) return null;

      const giftRes = await tx.execute(sql`
        SELECT id, occasion, title, amount, given_on, delivered_on, notes, created_at
        FROM client_gifts
        WHERE tenant_id = ${session.tenantId}::uuid AND investor_id = ${id}::uuid
        ORDER BY given_on DESC, created_at DESC
      `);
      const gifts = giftRes.rows.map(mapGift);
      const spent = gifts.reduce((sum, g) => sum + g.amount, 0);

      return {
        dob: (inv.dob as string | null) ?? null,
        budget: inv.budget == null ? null : Number(inv.budget),
        spent,
        gifts,
      };
    });
    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    // Client-linked write — same bar as editing the client record itself.
    requireAny(session.roles, ["investor.edit.all", "investor.edit.assigned"], session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = AddBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const body = parse.data;

    const result = await withTenant(session.tenantId, async (tx) => {
      // Verify the investor is visible in-tenant before inserting.
      // Pull the RM up front — the intimation below needs it, and it doubles
      // as the in-tenant existence check.
      const invRes = await tx.execute(sql`
        SELECT name, rm_id FROM investors
        WHERE id = ${id}::uuid AND tenant_id = ${session.tenantId}::uuid
        LIMIT 1
      `);
      if (invRes.rows.length === 0) return null;
      const inv = invRes.rows[0] as { name: string | null; rm_id: string | null };

      const ins = await tx.execute(sql`
        INSERT INTO client_gifts (tenant_id, investor_id, occasion, title, amount, given_on, delivered_on, notes, created_by)
        VALUES (
          ${session.tenantId}::uuid,
          ${id}::uuid,
          ${body.occasion},
          ${body.title},
          ${body.amount},
          ${body.givenOn}::date,
          ${body.deliveredOn ?? null}::date,
          ${body.notes ?? null},
          ${session.userId}::uuid
        )
        RETURNING id, occasion, title, amount, given_on, delivered_on, notes, created_at
      `);
      const gift = mapGift(ins.rows[0]);

      // Logged as already delivered → tell the RM now. Whoever ships the gift
      // is often not the RM, and the RM is the one who speaks to the client.
      if (gift.deliveredOn) {
        const sent = await notifyGiftDelivered(tx, {
          tenantId: session.tenantId,
          rmId: inv.rm_id,
          investorId: id,
          clientName: inv.name ?? "this client",
          giftTitle: gift.title,
          amount: gift.amount,
          onDate: gift.deliveredOn,
        });
        if (sent) {
          await tx.execute(sql`
            UPDATE client_gifts SET rm_notified_at = now() WHERE id = ${gift.id}::uuid
          `);
        }
      }
      return gift;
    });
    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(result, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    // Client-linked write — same bar as editing the client record itself.
    requireAny(session.roles, ["investor.edit.all", "investor.edit.assigned"], session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = BudgetBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const { budget } = parse.data;

    const result = await withTenant(session.tenantId, async (tx) => {
      const upd = await tx.execute(sql`
        UPDATE investors
        SET birthday_gift_budget = ${budget}
        WHERE id = ${id}::uuid AND tenant_id = ${session.tenantId}::uuid
        RETURNING birthday_gift_budget AS budget
      `);
      if (upd.rows.length === 0) return null;
      return { budget: upd.rows[0].budget == null ? null : Number(upd.rows[0].budget) };
    });
    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
