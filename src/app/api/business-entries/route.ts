import { handleApiError } from "@/lib/api/error-handler";
/**
 * Business Closing Entries collection.
 *
 *   GET  /api/business-entries   — list (filters: q, productType, status, rm, from, to)
 *   POST /api/business-entries   — create a header + scheme sub-form lines
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { and, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { businessEntries, businessEntryLines, investors, users, sips, eventsOutbox } from "@/db/schema";
import { EntryInput, normalizeLine, computeTotals } from "@/lib/business/entry-input";

export const dynamic = "force-dynamic";

const MANAGE_ROLES = ["owner", "branch_head", "rm", "back_office", "ops"];
const canManage = (roles: string[]) => roles.some((r) => MANAGE_ROLES.includes(r));

/** Who sees the WHOLE firm's business book vs only their own bookings. Owner /
 *  back-office / ops / compliance / branch-head manage the register; an RM sees
 *  the entries they booked. */
const seesAllEntries = (s: { roles: string[]; permissions?: string[] | null }) =>
  can(s.roles, "investor.view.all", s.permissions) || can(s.roles, "reports.business", s.permissions);

/** sips.frequency only has a subset of the business-line frequencies; map the
 *  overlap and default the rest (one_time / half_yearly) to monthly. */
function toSipFrequency(f: string | null | undefined): "monthly" | "quarterly" | "weekly" | "yearly" {
  return f === "quarterly" || f === "weekly" || f === "yearly" ? f : "monthly";
}

/** First debit date: the next occurrence of `sipDay` (1..28) on/after the SIP's
 *  start date. Returns the start date itself if no day was captured. */
function nextInstallmentDate(startISO: string, sipDay: string | null | undefined): string {
  if (!sipDay) return startISO;
  const day = Math.min(28, Math.max(1, Number(sipDay)));
  const base = new Date(`${startISO}T00:00:00Z`);
  let d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), day));
  if (d.getTime() < base.getTime()) d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, day));
  return d.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    if (!canManage(session.roles)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const sp = new URL(req.url).searchParams;
    const q = (sp.get("q") ?? "").trim();
    const productType = (sp.get("productType") ?? "").split(",").filter(Boolean);
    const status = (sp.get("status") ?? "").split(",").filter(Boolean);
    const rm = (sp.get("rm") ?? "").split(",").filter(Boolean);
    const from = sp.get("from");
    const to = sp.get("to");
    const limit = Math.min(200, Math.max(1, Number(sp.get("limit")) || 100));

    const rows = await withTenant(session.tenantId, async (tx) => {
      const conds: any[] = [eq(businessEntries.tenantId, session.tenantId)];
      // RMs see only the entries they booked; managers/ops see the whole firm.
      if (!seesAllEntries(session)) conds.push(eq(businessEntries.rmId, session.userId));
      if (q) conds.push(or(ilike(businessEntries.clientName, `%${q}%`), ilike(businessEntries.amcName, `%${q}%`))!);
      if (productType.length) conds.push(inArray(businessEntries.productType, productType as any));
      if (status.length) conds.push(inArray(businessEntries.status, status as any));
      if (rm.length) conds.push(inArray(businessEntries.rmId, rm as any));
      if (from) conds.push(gte(businessEntries.businessDate, from));
      if (to) conds.push(lte(businessEntries.businessDate, to));
      return tx
        .select({
          entry: businessEntries,
          rmName: users.name,
          lineCount: sql<number>`(SELECT count(*)::int FROM business_entry_lines l WHERE l.entry_id = ${businessEntries.id})`,
        })
        .from(businessEntries)
        .leftJoin(users, eq(users.id, businessEntries.rmId))
        .where(and(...conds))
        .orderBy(desc(businessEntries.businessDate), desc(businessEntries.createdAt))
        .limit(limit);
    });
    return NextResponse.json({ entries: rows });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    if (!canManage(session.roles)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = EntryInput.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const b = parse.data;
    const meta = clientMetaFromHeaders(req.headers);

    const lines = b.lines.map(normalizeLine);
    const totals = computeTotals(lines);
    const rmId = b.rmId ?? session.userId;
    const entryId = uuid();

    const outcome = await withTenant(session.tenantId, async (tx) => {
      if (b.investorId) {
        const [inv] = await tx
          .select({ id: investors.id })
          .from(investors)
          .where(and(eq(investors.id, b.investorId), eq(investors.tenantId, session.tenantId)))
          .limit(1);
        if (!inv) return "no_client" as const;
      }

      await tx.insert(businessEntries).values({
        id: entryId,
        tenantId: session.tenantId,
        investorId: b.investorId ?? null,
        clientName: b.clientName,
        productType: b.productType,
        platform: b.platform ?? null,
        businessDate: b.businessDate,
        status: b.status,
        rmId,
        amcName: b.amcName ?? null,
        folioNo: b.folioNo ?? null,
        totalAmount: String(totals.total),
        assetBreakup: totals.assetBreakup,
        liquidNet: String(totals.liquidNet),
        notes: b.notes ?? null,
        createdById: session.userId,
      } as any);

      await tx.insert(businessEntryLines).values(
        lines.map((l, i) => ({
          id: uuid(),
          tenantId: session.tenantId,
          entryId,
          schemeCode: l.schemeCode ?? null,
          schemeName: l.schemeName,
          amcName: l.amcName ?? null,
          assetCategory: l.assetCategory ?? null,
          assetClass: l.assetClass,
          txnType: l.txnType,
          amount: String(l.amount),
          units: l.units != null ? String(l.units) : null,
          frequency: l.frequency ?? null,
          sipDate: l.txnType === "sip" ? l.sipDate ?? null : null,
          fromSchemeCode: l.fromSchemeCode ?? null,
          fromSchemeName: l.fromSchemeName ?? null,
          fromAssetClass: l.fromAssetClass ?? null,
          folioNo: l.folioNo ?? null,
          notes: l.notes ?? null,
          sortOrder: i,
        })) as any
      );

      // Auto-register a SIP in the SIP book for every SIP line on a real client,
      // so it shows in the SIP Tracker AND its installment day drives the
      // reminder workflows (date rules on sips.next_installment_at). Only on
      // create + only when the entry has a linked investor.
      if (b.investorId) {
        const sipRows = lines
          .filter((l) => l.txnType === "sip")
          .map((l) => {
            const id = uuid();
            return {
              row: {
                id,
                tenantId: session.tenantId,
                investorId: b.investorId!,
                schemeCode: l.schemeCode ?? null,
                schemeName: l.schemeName,
                amcName: l.amcName ?? null,
                folioNumber: l.folioNo ?? b.folioNo ?? null,
                amount: String(l.amount),
                frequency: toSipFrequency(l.frequency),
                sipDate: l.sipDate ?? null,
                startDate: b.businessDate,
                nextInstallmentAt: nextInstallmentDate(b.businessDate, l.sipDate),
                status: "active" as const,
                rmId,
              },
              id,
            };
          });
        if (sipRows.length) {
          await tx.insert(sips).values(sipRows.map((s) => s.row) as any);
          await tx.insert(eventsOutbox).values(
            sipRows.map((s) => ({
              tenantId: session.tenantId,
              kind: "sip.created",
              entityType: "sip",
              entityId: s.id,
              after: s.row as any,
              meta: { source: "business_entry", entryId } as any,
            })) as any
          );
        }
      }

      // Emit business_entry.created so workflow rules can react (e.g. send the
      // client a transaction confirmation). The snapshot carries the fields the
      // rule's criteria + template tokens read.
      await tx.insert(eventsOutbox).values({
        tenantId: session.tenantId,
        kind: "business_entry.created",
        entityType: "business_entry",
        entityId: entryId,
        after: {
          id: entryId,
          investor_id: b.investorId ?? null,
          client_name: b.clientName,
          product_type: b.productType,
          status: b.status,
          total_amount: String(totals.total),
          amc_name: b.amcName ?? null,
          platform: b.platform ?? null,
          rm_id: rmId,
          business_date: b.businessDate,
        } as any,
        meta: { userId: session.userId } as any,
      } as any);

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "business_entry.create",
        entityType: "business_entry",
        entityId: entryId,
        after: { clientName: b.clientName, productType: b.productType, total: totals.total, lines: lines.length } as any,
        ...meta,
      });
      return "ok" as const;
    });

    if (outcome === "no_client") return NextResponse.json({ error: "client not found in this firm" }, { status: 400 });
    return NextResponse.json({ id: entryId }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
