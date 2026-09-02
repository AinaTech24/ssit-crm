import { handleApiError } from "@/lib/api/error-handler";
/**
 * Manual insurance commission ledger.
 *   GET  /api/insurance/commission-entries — list (scoped to own book for non-managers)
 *   POST /api/insurance/commission-entries — record a commission receipt
 */
import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, can } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { insuranceCommissionEntries, COMMISSION_TYPES } from "@/db/schema";

export const dynamic = "force-dynamic";

const Body = z.object({
  entryDate: z.string(), // YYYY-MM-DD
  insurer: z.string().max(160).optional(),
  policyId: z.string().uuid().optional(),
  policyNumber: z.string().max(80).optional(),
  investorId: z.string().uuid().optional(),
  commissionType: z.enum(COMMISSION_TYPES).default("first_year"),
  grossAmount: z.number().min(0).default(0),
  tdsAmount: z.number().min(0).default(0),
  /** Optional explicit net; otherwise gross − tds. */
  netAmount: z.number().min(0).optional(),
  periodLabel: z.string().max(60).optional(),
  referenceNo: z.string().max(120).optional(),
  notes: z.string().max(2000).optional(),
});

export async function GET() {
  try {
    const session = await requireSession();
    requireCap(session.roles, "insurance.view", session.permissions);
    const seesAll =
      can(session.roles, "investor.view.all", session.permissions) || can(session.roles, "compliance.view", session.permissions);
    const rows = await withTenant(session.tenantId, async (tx) => {
      const scope = seesAll ? sql`` : sql` AND recorded_by_user_id = ${session.userId}::uuid`;
      const r = await tx.execute(sql`
        SELECT ce.*, COALESCE(i.name, '') AS investor_name, COALESCE(u.name, '') AS recorded_by_name
        FROM insurance_commission_entries ce
        LEFT JOIN investors i ON i.id = ce.investor_id
        LEFT JOIN users u ON u.id = ce.recorded_by_user_id
        WHERE ce.tenant_id = ${session.tenantId}::uuid${scope}
        ORDER BY ce.entry_date DESC, ce.created_at DESC
        LIMIT 500
      `);
      return r.rows;
    });
    return NextResponse.json({ entries: rows });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "insurance.write", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const b = parse.data;
    const net = b.netAmount != null ? b.netAmount : Math.max(0, b.grossAmount - b.tdsAmount);
    const id = uuid();
    const clientMeta = clientMetaFromHeaders(req.headers);

    await withTenant(session.tenantId, async (tx) => {
      await tx.insert(insuranceCommissionEntries).values({
        id,
        tenantId: session.tenantId,
        branchId: session.branchId ?? null,
        entryDate: b.entryDate.slice(0, 10),
        insurer: b.insurer ?? null,
        policyId: b.policyId ?? null,
        policyNumber: b.policyNumber ?? null,
        investorId: b.investorId ?? null,
        commissionType: b.commissionType,
        grossAmount: String(b.grossAmount),
        tdsAmount: String(b.tdsAmount),
        netAmount: String(net),
        periodLabel: b.periodLabel ?? null,
        referenceNo: b.referenceNo ?? null,
        notes: b.notes ?? null,
        recordedByUserId: session.userId,
      } as any);
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "insurance_commission.record",
        entityType: "insurance_commission_entry",
        entityId: id,
        after: { insurer: b.insurer, commissionType: b.commissionType, grossAmount: b.grossAmount, netAmount: net } as any,
        ...clientMeta,
      });
    });
    return NextResponse.json({ id, netAmount: net }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
