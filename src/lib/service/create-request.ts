/**
 * Shared service-request creation + WhatsApp intent detection.
 *
 * createServiceRequest() centralises the ticket-number, SLA, timeline, event,
 * and client-acknowledgement so both the manual API and the WhatsApp intake can
 * open a fully-formed, ETA-acknowledged ticket.
 *
 * detectServiceIntent() turns a free-text client message ("please pause my
 * SIP", "send me my statement") into a structured (type, subject) using simple
 * deterministic keywords — no AI call needed, so it's instant and reliable.
 */

import { v4 as uuid } from "uuid";
import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { serviceRequests, eventsOutbox } from "@/db/schema";
import { acknowledgeServiceRequest } from "./acknowledge";
import { notifyClientTeam } from "@/lib/notifications/client-team";

export const SLA_HOURS_BY_TYPE: Record<string, number> = {
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
  complaint: 24 * 21,
};

export type CreateSrArgs = {
  tenantId: string;
  investorId: string | null;
  type: string;
  channel?: "whatsapp" | "email" | "phone" | "in_person" | "form";
  subject: string;
  description?: string;
  priority?: "low" | "normal" | "high" | "urgent";
  assignedToUserId?: string | null;
  actorUserId?: string | null;
  actorName?: string | null;
};

export async function createServiceRequest(
  tx: Tx,
  args: CreateSrArgs
): Promise<{ id: string; ticketNo: string; slaResolutionAt: Date }> {
  const id = uuid();
  const slaHours = SLA_HOURS_BY_TYPE[args.type] ?? 24 * 7;
  const slaResolutionAt = new Date(Date.now() + slaHours * 60 * 60 * 1000);
  const slaResponseAt = new Date(Date.now() + slaHours * 60 * 60 * 1000 * 0.25);

  const seq = await tx.execute(sql`
    SELECT COUNT(*)::int + 1 AS n FROM service_requests
    WHERE tenant_id = ${args.tenantId}::uuid AND created_at >= date_trunc('year', now())
  `);
  const n = Number((seq.rows[0] as any)?.n ?? 1);
  const ticketNo = `SR-${new Date().getFullYear()}-${String(n).padStart(5, "0")}`;

  // No explicit assignee: a request about a client goes to that client's Service RM.
  let assignee: string | null = args.assignedToUserId ?? null;
  if (!assignee && args.investorId) {
    const r = await tx.execute(sql`
      SELECT i.service_rm_id AS id FROM investors i
        JOIN users u ON u.id = i.service_rm_id AND u.status = 'active'
       WHERE i.id = ${args.investorId}::uuid AND i.tenant_id = ${args.tenantId}::uuid
       LIMIT 1
    `);
    assignee = ((r.rows[0] as { id?: string } | undefined)?.id) ?? null;
  }

  await tx.insert(serviceRequests).values({
    id,
    tenantId: args.tenantId,
    ticketNo,
    investorId: args.investorId ?? null,
    assignedToUserId: assignee,
    type: args.type as any,
    channel: (args.channel ?? "whatsapp") as any,
    subject: args.subject,
    description: args.description ?? args.subject,
    priority: (args.priority ?? "normal") as any,
    status: "open",
    slaResponseAt,
    slaResolutionAt,
    complaintSource: args.type === "complaint" ? "direct" : null,
    timeline: [
      { at: new Date().toISOString(), by: args.actorUserId ?? "system", event: "created", note: `Created by ${args.actorName ?? "WhatsApp intake"}` },
    ],
  } as any);

  await tx.insert(eventsOutbox).values({
    tenantId: args.tenantId,
    kind: args.type === "complaint" ? "complaint.created" : "service_request.created",
    entityType: "service_request",
    entityId: id,
    after: { ticketNo, type: args.type, priority: args.priority ?? "normal" } as any,
    meta: { userId: args.actorUserId ?? null, source: args.actorUserId ? "manual" : "wa_intake" } as any,
  } as any);

  await acknowledgeServiceRequest(tx, {
    tenantId: args.tenantId,
    srId: id,
    ticketNo,
    type: args.type,
    slaResolutionAt,
    investorId: args.investorId ?? null,
  });

  if (args.investorId) {
    await notifyClientTeam(tx, {
      tenantId: args.tenantId,
      investorId: args.investorId,
      actorUserId: args.actorUserId ?? "",
      kind: "client.service_request",
      title: "Service request raised for {client}",
      body: `${ticketNo} · ${args.subject}`.slice(0, 240),
      linkUrl: `/dashboard/service-requests/${id}`,
    });
  }

  return { id, ticketNo, slaResolutionAt };
}

/** Map a free-text client message to a service-request (type, subject), or null. */
export function detectServiceIntent(text: string): { type: string; subject: string } | null {
  const t = (text ?? "").toLowerCase();
  if (!t.trim()) return null;
  const has = (re: RegExp) => re.test(t);

  if (has(/\b(account statement|portfolio statement|statement|holding statement|holdings? report)\b/))
    return { type: "statement_request", subject: "Statement request (via WhatsApp)" };
  if (has(/\b(capital gain|cap gain|stcg|ltcg|tax statement|gain.?loss)\b/))
    return { type: "capital_gain_report", subject: "Capital gains statement request (via WhatsApp)" };
  if (has(/\b(redeem|redemption|withdraw|sell.*(fund|units?)|cash out)\b/))
    return { type: "redemption_request", subject: "Redemption request (via WhatsApp)" };
  if (has(/\b(switch|move.*(fund|scheme)|change.*scheme)\b/))
    return { type: "switch_request", subject: "Switch request (via WhatsApp)" };
  if (has(/\b(nominee|nomination)\b/))
    return { type: "nominee_update", subject: "Nominee update (via WhatsApp)" };
  if (has(/\b(bank account|bank update|change.*bank|new bank|ifsc)\b/))
    return { type: "bank_update", subject: "Bank update (via WhatsApp)" };
  if (has(/\b(mobile|phone number|contact number)\b/) && has(/\b(change|update|new)\b/))
    return { type: "mobile_update", subject: "Mobile update (via WhatsApp)" };
  if (has(/\b(email)\b/) && has(/\b(change|update|new)\b/))
    return { type: "email_update", subject: "Email update (via WhatsApp)" };
  if (has(/\b(kyc|re.?kyc|pan|aadhaar|aadhar)\b/))
    return { type: "kyc_update", subject: "KYC update (via WhatsApp)" };
  if (has(/\b(complaint|grievance|not happy|unhappy|disappointed|escalat)\b/))
    return { type: "complaint", subject: "Complaint (via WhatsApp)" };
  return null;
}
