import { handleApiError } from "@/lib/api/error-handler";
/**
 * SIP rejection records — collection.
 *
 *   GET  /api/sip-rejections           — list with investor + RM joined
 *   POST /api/sip-rejections           — create a rejection record (also auto-creates a follow-up task)
 *
 * Idempotency: POST with the same `transactionId` returns the existing
 * record (no duplicates from feed replays).
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { sipRejections, investors, tasks, notifications, eventsOutbox } from "@/db/schema";

export const dynamic = "force-dynamic";

const Body = z.object({
  investorId: z.string().uuid(),
  transactionId: z.string().uuid().optional(),
  sipId: z.string().uuid().optional(),
  rejectionDate: z.string(), // ISO date
  rejectionAmount: z.number().positive(),
  rejectionReason: z.string().optional(),
  schemeName: z.string().optional(),
  folioNumber: z.string().optional(),
  amcName: z.string().optional(),
  assignedRmId: z.string().uuid().optional(),
  followUpDate: z.string().optional(),
  remarks: z.string().optional(),
});

export async function GET() {
  try {
    const session = await requireSession();
    const rows = await withTenant(session.tenantId, async (tx) => {
      const r = await tx.execute(sql`
        SELECT r.*, i.name AS investor_name, i.pan AS investor_pan, u.name AS rm_name
        FROM sip_rejections r
        LEFT JOIN investors i ON i.id = r.investor_id
        LEFT JOIN users u ON u.id = r.assigned_rm_id
        WHERE r.tenant_id = ${session.tenantId}::uuid
        ORDER BY r.rejection_date DESC, r.created_at DESC
        LIMIT 500
      `);
      return r.rows;
    });
    return NextResponse.json({ rejections: rows });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "transactions.execute", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const body = parse.data;
    const clientMeta = clientMetaFromHeaders(req.headers);

    const result = await withTenant(session.tenantId, async (tx) => {
      // Idempotency on transactionId
      if (body.transactionId) {
        const existing = await tx.execute(sql`
          SELECT id FROM sip_rejections WHERE tenant_id = ${session.tenantId}::uuid AND transaction_id = ${body.transactionId} LIMIT 1
        `);
        if (existing.rows.length) {
          return { id: (existing.rows[0] as any).id, alreadyExisted: true };
        }
      }

      const inv = (await tx.select().from(investors).where(eq(investors.id, body.investorId)).limit(1))[0];
      if (!inv) throw Object.assign(new Error("investor not found"), { status: 404 });

      const id = uuid();
      const assignedRm = body.assignedRmId ?? inv.rmId ?? session.userId;
      const followUp = body.followUpDate ?? new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

      await tx.insert(sipRejections).values({
        id,
        tenantId: session.tenantId,
        investorId: body.investorId,
        transactionId: body.transactionId ?? null,
        sipId: body.sipId ?? null,
        rejectionDate: body.rejectionDate.slice(0, 10),
        rejectionAmount: body.rejectionAmount.toString(),
        rejectionReason: body.rejectionReason ?? null,
        schemeName: body.schemeName ?? null,
        folioNumber: body.folioNumber ?? null,
        amcName: body.amcName ?? null,
        assignedRmId: assignedRm,
        followUpDate: followUp,
        recoveryStatus: "pending",
        remarks: body.remarks ?? null,
      } as any);

      // ─── Automation 1 — auto-create task for the RM ───────────────────
      await tx.insert(tasks).values({
        id: uuid(),
        tenantId: session.tenantId,
        branchId: session.branchId ?? null,
        assigneeId: assignedRm,
        subjectType: "investor",
        subjectId: body.investorId,
        type: "sip_rejection_followup",
        title: `SIP rejection — call ${inv.name}`,
        description: `Recover ₹${body.rejectionAmount.toLocaleString("en-IN")} SIP rejected on ${body.rejectionDate}. Reason: ${body.rejectionReason ?? "unknown"}.`,
        priority: "high",
        status: "open",
        dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // due tomorrow
        slaDueAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // 2-day SLA
      } as any);

      // ─── Automation 1b — in-app notification for the RM ───────────────
      await tx.insert(notifications).values({
        id: uuid(),
        tenantId: session.tenantId,
        userId: assignedRm,
        kind: "sip.rejected",
        title: `SIP rejected — ${inv.name}`,
        body: `₹${body.rejectionAmount.toLocaleString("en-IN")} · ${body.rejectionReason ?? "Reason unknown"}`,
        linkUrl: `/dashboard/sip-rejections`,
        severity: "warning",
        meta: { rejection_id: id, investor_id: body.investorId, amount: body.rejectionAmount } as any,
      } as any);

      // ─── Outbox — so any subscribed workflow can react ────────────────
      await tx.insert(eventsOutbox).values({
        tenantId: session.tenantId,
        kind: "sip.rejection.created",
        entityType: "sip_rejection",
        entityId: id,
        after: { investorId: body.investorId, amount: body.rejectionAmount, reason: body.rejectionReason },
        meta: { userId: session.userId } as any,
      } as any);

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "sip_rejection.create",
        entityType: "sip_rejection",
        entityId: id,
        after: {
          investorId: body.investorId,
          amount: body.rejectionAmount,
          reason: body.rejectionReason,
          assignedRmId: assignedRm,
        } as any,
        ...clientMeta,
      });

      return { id, assignedRmId: assignedRm, followUpDate: followUp, alreadyExisted: false };
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
