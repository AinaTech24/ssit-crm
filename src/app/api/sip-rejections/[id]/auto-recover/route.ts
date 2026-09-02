import { handleApiError } from "@/lib/api/error-handler";
import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { sipRejections, investors, tasks, eventsOutbox } from "@/db/schema";

export const dynamic = "force-dynamic";

/**
 * POST /api/sip-rejections/[id]/auto-recover
 *
 * Triggers the automated SIP Rejection & Mandate Bounce Recovery sequence:
 *   1. Pushes a `transaction.failed.sip_rejection` domain event to events_outbox
 *      to fire the workflow pipeline (WhatsApp alert to investor with UPI retry link).
 *   2. Creates a high-priority follow-up Task for the assigned RM with 48h SLA.
 *   3. Updates the rejection recovery status to 'client_contacted'.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireAny(
      session.roles,
      ["transactions.manage", "rm", "branch_head", "ops", "owner", "compliance"],
      session.permissions
    );

    const { id } = await params;

    const result = await withTenant(
      session.tenantId,
      async (tx) => {
        const [rej] = await tx
          .select()
          .from(sipRejections)
          .where(and(eq(sipRejections.id, id), eq(sipRejections.tenantId, session.tenantId)))
          .limit(1);

        if (!rej) {
          return { notFound: true };
        }

        const [inv] = await tx
          .select({
            id: investors.id,
            name: investors.name,
            phone: investors.phone,
            email: investors.email,
            rmId: investors.rmId,
          })
          .from(investors)
          .where(and(eq(investors.id, rej.investorId), eq(investors.tenantId, session.tenantId)))
          .limit(1);

        const rmId = rej.assignedRmId || inv?.rmId || session.userId;
        const reasonCategory = rej.reasonCategory || "insufficient_balance";

        // 1. Enqueue outbox event for workflow engine & communication pipeline
        await tx.insert(eventsOutbox).values({
          id: uuid(),
          tenantId: session.tenantId,
          eventKind: "transaction.failed.sip_rejection",
          subjectType: "investor",
          subjectId: rej.investorId,
          payload: {
            rejection_id: rej.id,
            reason_code: reasonCategory,
            scheme_name: rej.schemeName || "Mutual Fund Scheme",
            amount: rej.rejectionAmount,
            order_date: rej.rejectionDate,
            investor_name: inv?.name || "Investor",
            investor_phone: inv?.phone || null,
          },
          status: "pending",
        } as any);

        // 2. Create high-priority task for RM
        const dueAt = new Date();
        dueAt.setDate(dueAt.getDate() + 2); // 48h SLA

        await tx.insert(tasks).values({
          id: uuid(),
          tenantId: session.tenantId,
          title: `Recover Rejected SIP: ${inv?.name || "Client"} (${rej.schemeName || "Scheme"})`,
          description: `SIP of ₹${rej.rejectionAmount} failed on ${rej.rejectionDate}. Reason: ${rej.rejectionReason || reasonCategory}. Contact client to verify balance or update mandate.`,
          taskType: "sip_retry",
          priority: "high",
          status: "todo",
          assigneeId: rmId,
          createdById: session.userId,
          investorId: rej.investorId,
          dueAt,
        } as any);

        // 3. Update rejection recovery status
        const timestamp = new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
        const newRemark = `⚡ [Auto-Recover ${timestamp}]: Automated WhatsApp recovery triggered and high-priority RM task created.`;
        const updatedRemarks = rej.remarks ? `${newRemark}\n${rej.remarks}` : newRemark;

        await tx
          .update(sipRejections)
          .set({
            recoveryStatus: "client_contacted",
            statusChangedAt: new Date(),
            remarks: updatedRemarks,
            followUpDate: dueAt.toISOString().slice(0, 10),
            assignedRmId: rmId,
            updatedAt: new Date(),
          } as any)
          .where(and(eq(sipRejections.id, id), eq(sipRejections.tenantId, session.tenantId)));

        return { success: true, investorName: inv?.name };
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    if (result.notFound) {
      return NextResponse.json({ error: "SIP Rejection record not found" }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      message: `Auto-recovery workflow triggered successfully for ${result.investorName || "investor"}.`,
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
