import { handleApiError } from "@/lib/api/error-handler";
/**
 * Service requests / complaint register.
 *   GET  /api/service-requests
 *   POST /api/service-requests
 *
 * Complaints are routed through the SEBI-format register. SLA clocks are
 * computed from the type: complaints = 30 days max, KYC updates = 7 days, etc.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { desc, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { serviceRequests, eventsOutbox } from "@/db/schema";
import { acknowledgeServiceRequest } from "@/lib/service/acknowledge";

export const dynamic = "force-dynamic";

/**
 * Default SLAs in hours per service type — spec § Module 13.
 * Tunable later via masters; Equitywala-recommended starting points below.
 */
const SLA_HOURS_BY_TYPE: Record<string, number> = {
  // Spec-canonical 13
  nominee_update: 24 * 14,
  bank_update: 24 * 7,
  mobile_update: 24 * 2,
  email_update: 24 * 2,
  kyc_update: 24 * 7,
  minor_to_major: 24 * 30,
  capital_gain_report: 24 * 3,
  statement_request: 24 * 2,
  redemption_request: 24,
  switch_request: 24 * 3,
  transmission_case: 24 * 45,
  folio_correction: 24 * 7,
  other: 24 * 7,
  // Legacy
  complaint: 24 * 21, // SEBI requires 21 days max for resolution
  redemption_help: 24,
  switch_help: 24 * 3,
  transaction_query: 24 * 3,
};

const CreateBody = z.object({
  investorId: z.string().uuid().optional(),
  assignedToUserId: z.string().uuid().optional(),
  type: z.enum([
    // Spec-canonical (13)
    "nominee_update",
    "bank_update",
    "mobile_update",
    "email_update",
    "kyc_update",
    "minor_to_major",
    "capital_gain_report",
    "statement_request",
    "redemption_request",
    "switch_request",
    "transmission_case",
    "folio_correction",
    "other",
    // Legacy
    "complaint",
    "redemption_help",
    "switch_help",
    "transaction_query",
  ]),
  channel: z.enum(["whatsapp", "email", "phone", "in_person", "form"]).optional(),
  subject: z.string().min(2).max(300),
  description: z.string().optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  sebiCategory: z.string().optional(),
  sebiSubCategory: z.string().optional(),
  complaintSource: z.string().optional(),
  scoresRefNo: z.string().max(80).optional(),
  remarks: z.string().optional(),
});

export async function GET() {
  try {
    const session = await requireSession();
    const rows = await withTenant(session.tenantId, async (tx) => {
      return tx.select().from(serviceRequests).orderBy(desc(serviceRequests.createdAt));
    });
    return NextResponse.json({ serviceRequests: rows });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "service_request.manage", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = CreateBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const body = parse.data;

    const id = uuid();
    const slaHours = SLA_HOURS_BY_TYPE[body.type] ?? 24 * 7;
    const slaResolutionAt = new Date(Date.now() + slaHours * 60 * 60 * 1000);
    // First-response SLA is 25% of resolution time (rule of thumb)
    const slaResponseAt = new Date(Date.now() + slaHours * 60 * 60 * 1000 * 0.25);

    await withTenant(session.tenantId, async (tx) => {
      // Ticket number: per-tenant per-year counter
      const seqRes = await tx.execute(sql`
        SELECT COUNT(*)::int + 1 AS n FROM service_requests
        WHERE tenant_id = ${session.tenantId}::uuid AND created_at >= date_trunc('year', now())
      `);
      const n = Number((seqRes.rows[0] as any)?.n ?? 1);
      const ticketNo = `SR-${new Date().getFullYear()}-${String(n).padStart(5, "0")}`;

      await tx.insert(serviceRequests).values({
        id,
        tenantId: session.tenantId,
        ticketNo,
        investorId: body.investorId ?? null,
        assignedToUserId: body.assignedToUserId ?? session.userId,
        type: body.type,
        channel: body.channel,
        subject: body.subject,
        description: body.description,
        priority: body.priority,
        status: "open",
        slaResponseAt,
        slaResolutionAt,
        sebiCategory: body.sebiCategory,
        sebiSubCategory: body.sebiSubCategory,
        complaintSource: body.type === "complaint" ? (body.complaintSource ?? "direct") : null,
        scoresRefNo: body.scoresRefNo ?? null,
        remarks: body.remarks ?? null,
        timeline: [
          {
            at: new Date().toISOString(),
            by: session.userId,
            event: "created",
            note: `Created by ${session.name}`,
          },
        ],
      } as any);

      await tx.insert(eventsOutbox).values({
        tenantId: session.tenantId,
        kind: body.type === "complaint" ? "complaint.created" : "service_request.created",
        entityType: "service_request",
        entityId: id,
        after: { ticketNo, type: body.type, priority: body.priority } as any,
        meta: { userId: session.userId } as any,
      } as any);

      // Instant client acknowledgement with a promised resolution ETA.
      await acknowledgeServiceRequest(tx, {
        tenantId: session.tenantId,
        srId: id,
        ticketNo,
        type: body.type,
        slaResolutionAt,
        investorId: body.investorId ?? null,
      });
    });

    return NextResponse.json({ id }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
