import { handleApiError } from "@/lib/api/error-handler";
/**
 *   GET    /api/business-entries/[id]   — header + scheme sub-form lines
 *   PATCH  /api/business-entries/[id]   — update header + (optionally) replace lines
 *   DELETE /api/business-entries/[id]   — delete (cascades lines)
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { businessEntries, businessEntryLines, eventsOutbox } from "@/db/schema";
import {
  PRODUCT_TYPES,
  BUSINESS_ENTRY_STATUSES,
} from "@/db/schema/business_entries";
import { LineInput, normalizeLine, computeTotals } from "@/lib/business/entry-input";

export const dynamic = "force-dynamic";

const MANAGE_ROLES = ["owner", "branch_head", "rm", "back_office", "ops"];
const canManage = (roles: string[]) => roles.some((r) => MANAGE_ROLES.includes(r));
/** Managers/ops see any entry; an RM only the entries they booked. */
const seesAllEntries = (s: { roles: string[]; permissions?: string[] | null }) =>
  can(s.roles, "investor.view.all", s.permissions) || can(s.roles, "reports.business", s.permissions);

const PatchInput = z.object({
  investorId: z.string().uuid().nullish(),
  clientName: z.string().min(1).max(200).optional(),
  productType: z.enum(PRODUCT_TYPES).optional(),
  platform: z.string().max(80).nullish(),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(BUSINESS_ENTRY_STATUSES).optional(),
  rmId: z.string().uuid().nullish(),
  executedById: z.string().uuid().nullish(),
  amcName: z.string().max(150).nullish(),
  folioNo: z.string().max(60).nullish(),
  notes: z.string().max(4000).nullish(),
  lines: z.array(LineInput).min(1).max(100).optional(),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    if (!canManage(session.roles)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const data = await withTenant(session.tenantId, async (tx) => {
      const [entry] = await tx
        .select()
        .from(businessEntries)
        .where(and(eq(businessEntries.id, id), eq(businessEntries.tenantId, session.tenantId)))
        .limit(1);
      if (!entry) return null;
      // RMs may only open their own bookings.
      if (!seesAllEntries(session) && entry.rmId !== session.userId) return null;
      const lines = await tx
        .select()
        .from(businessEntryLines)
        .where(eq(businessEntryLines.entryId, id))
        .orderBy(asc(businessEntryLines.sortOrder));
      return { entry, lines };
    });
    if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(data);
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    if (!canManage(session.roles)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = PatchInput.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const b = parse.data;
    const meta = clientMetaFromHeaders(req.headers);

    const outcome = await withTenant(session.tenantId, async (tx) => {
      const [before] = await tx
        .select()
        .from(businessEntries)
        .where(and(eq(businessEntries.id, id), eq(businessEntries.tenantId, session.tenantId)))
        .limit(1);
      if (!before) return "not_found" as const;
      // RMs may only edit their own bookings.
      if (!seesAllEntries(session) && before.rmId !== session.userId) return "forbidden" as const;

      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (b.investorId !== undefined) set.investorId = b.investorId;
      if (b.clientName !== undefined) set.clientName = b.clientName;
      if (b.productType !== undefined) set.productType = b.productType;
      if (b.platform !== undefined) set.platform = b.platform ?? null;
      if (b.businessDate !== undefined) set.businessDate = b.businessDate;
      if (b.status !== undefined) set.status = b.status;
      if (b.rmId !== undefined) set.rmId = b.rmId;
      if (b.executedById !== undefined) set.executedById = b.executedById;
      if (b.amcName !== undefined) set.amcName = b.amcName;
      if (b.folioNo !== undefined) set.folioNo = b.folioNo;
      if (b.notes !== undefined) set.notes = b.notes;

      // If a new line set is supplied, replace all lines + recompute totals.
      if (b.lines) {
        const lines = b.lines.map(normalizeLine);
        const totals = computeTotals(lines);
        set.totalAmount = String(totals.total);
        set.assetBreakup = totals.assetBreakup;
        set.liquidNet = String(totals.liquidNet);
        await tx.delete(businessEntryLines).where(eq(businessEntryLines.entryId, id));
        await tx.insert(businessEntryLines).values(
          lines.map((l, i) => ({
            id: uuid(),
            tenantId: session.tenantId,
            entryId: id,
            schemeCode: l.schemeCode ?? null,
            schemeName: l.schemeName,
            amcName: l.amcName ?? null,
            assetCategory: l.assetCategory ?? null,
            assetClass: l.assetClass,
            txnType: l.txnType,
            amount: String(l.amount),
            units: l.units != null ? String(l.units) : null,
            frequency: l.frequency ?? null,
            sipDate: l.txnType === "sip" || l.txnType === "swp" ? l.sipDate ?? null : null,
            fromSchemeCode: l.fromSchemeCode ?? null,
            fromSchemeName: l.fromSchemeName ?? null,
            fromAssetClass: l.fromAssetClass ?? null,
            folioNo: l.folioNo ?? null,
            notes: l.notes ?? null,
            sortOrder: i,
          })) as any
        );
      }

      await tx.update(businessEntries).set(set as any).where(eq(businessEntries.id, id));

      // Emit business_entry.updated (snake-case before/after) so workflow rules
      // can react to a draft → confirmed change — e.g. send the client a
      // transaction confirmation. Snapshots use the snake_case keys the rule
      // criteria + recipient resolution read.
      const [afterRow] = await tx
        .select()
        .from(businessEntries)
        .where(and(eq(businessEntries.id, id), eq(businessEntries.tenantId, session.tenantId)))
        .limit(1);
      const snap = (e: any) =>
        e
          ? {
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
            }
          : null;
      await tx.insert(eventsOutbox).values({
        tenantId: session.tenantId,
        kind: "business_entry.updated",
        entityType: "business_entry",
        entityId: id,
        before: snap(before) as any,
        after: snap(afterRow ?? before) as any,
        meta: { userId: session.userId } as any,
      } as any);

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "business_entry.update",
        entityType: "business_entry",
        entityId: id,
        before: { status: before.status, total: before.totalAmount } as any,
        after: { ...b, lines: b.lines?.length } as any,
        ...meta,
      });
      return "ok" as const;
    });

    if (outcome === "not_found") return NextResponse.json({ error: "not found" }, { status: 404 });
    if (outcome === "forbidden") return NextResponse.json({ error: "you can only edit entries you booked" }, { status: 403 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    if (!canManage(session.roles)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const meta = clientMetaFromHeaders(req.headers);
    const outcome = await withTenant(session.tenantId, async (tx) => {
      const [before] = await tx
        .select({ id: businessEntries.id, clientName: businessEntries.clientName, rmId: businessEntries.rmId, status: businessEntries.status })
        .from(businessEntries)
        .where(and(eq(businessEntries.id, id), eq(businessEntries.tenantId, session.tenantId)))
        .limit(1);
      if (!before) return "not_found" as const;
      // RMs may only cancel their own bookings.
      if (!seesAllEntries(session) && before.rmId !== session.userId) return "forbidden" as const;
      // Soft delete: business entries are revenue/AUM records that feed the FY/MTD
      // book, scorecards and reconciliation — void them (status='cancelled')
      // rather than hard-deleting the row + its audit trail.
      await tx
        .update(businessEntries)
        .set({ status: "cancelled", updatedAt: new Date() } as any)
        .where(and(eq(businessEntries.id, id), eq(businessEntries.tenantId, session.tenantId)));
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "business_entry.cancel",
        entityType: "business_entry",
        entityId: id,
        before: { clientName: before.clientName, status: before.status } as any,
        ...meta,
      });
      return "ok" as const;
    });
    if (outcome === "not_found") return NextResponse.json({ error: "not found" }, { status: 404 });
    if (outcome === "forbidden") return NextResponse.json({ error: "you can only cancel entries you booked" }, { status: 403 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
