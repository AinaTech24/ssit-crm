/**
 * Service-request acknowledgement — close the loop the instant a ticket opens.
 *
 * "I messaged my advisor and immediately got an acknowledgement with a promised
 * resolution time" is the single biggest perception-of-service lever. This sends
 * the client a confirmation (ticket no + promised resolution date), translated to
 * their preferred language, and always writes a communications audit row.
 *
 * Best-effort + fail-safe: a missing email / Resend key / any send error never
 * throws — the ticket is already created; the ack just degrades to an audited
 * "queued" row the RM can relay.
 */

import { v4 as uuid } from "uuid";
import { and, eq } from "drizzle-orm";
import { Resend } from "resend";
import type { Tx } from "@/db/client";
import { investors, tenants, communications, templates, templateVersions } from "@/db/schema";
import { translateText } from "@/lib/comms/translate";
import { gateClientSend } from "@/lib/comms/guarded-send";
import { dispatch } from "@/lib/comms/pipeline";
import { ensureServiceAckTemplate, mapAckVariables, SR_ACK_MATCHER } from "./ack-template";

let resendClient: Resend | null = null;
function getResend(): Resend | null {
  if (resendClient) return resendClient;
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  resendClient = new Resend(key);
  return resendClient;
}

export async function acknowledgeServiceRequest(
  tx: Tx,
  args: {
    tenantId: string;
    srId: string;
    ticketNo: string;
    type: string;
    slaResolutionAt: Date;
    investorId: string | null;
    /** The CRM user who raised it (null for the WhatsApp intake). */
    actorUserId?: string | null;
  }
): Promise<{ sent: boolean }> {
  if (!args.investorId) return { sent: false };
  try {
    const [inv] = await tx
      .select({
        name: investors.name,
        email: investors.email,
        phone: investors.phone,
        whatsappPhone: investors.whatsappPhone,
        lang: investors.languagePref,
      })
      .from(investors)
      .where(eq(investors.id, args.investorId))
      .limit(1);
    if (!inv) return { sent: false };
    const [t] = await tx.select().from(tenants).where(eq(tenants.id, args.tenantId)).limit(1);
    const tenant = t as any;

    const eta = args.slaResolutionAt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    const lines = await translateText(
      [
        `Hi ${inv.name ?? ""},`,
        `We've received your request (ref ${args.ticketNo}). Our team will get back to you by ${eta}.`,
        `Thank you for banking your trust with us.`,
      ],
      inv.lang
    );
    const signoff = `— ${tenant?.displayName ?? ""}, ARN ${tenant?.arn ?? "—"}`;
    const ackText = [...lines, signoff].join("\n");

    const values = { name: inv.name ?? "there", ticket: args.ticketNo, eta, firm: tenant?.displayName ?? tenant?.legalName ?? "" };
    const waPhone = (inv.whatsappPhone || inv.phone || "").trim();
    let sent = false;

    // ── Email ────────────────────────────────────────────────────────────────
    if (inv.email) {
      try {
        sent = await sendEmailAck(tx, args, { email: inv.email, lines, signoff, ackText });
      } catch (err) {
        // An email problem must never stop the WhatsApp acknowledgement below.
        console.error("[sr-ack] email non-fatal:", (err as Error).message);
      }
    }

    // ── WhatsApp ─────────────────────────────────────────────────────────────
    // Sent as well as (not instead of) email — the client asked on whichever channel
    // they use, and a WhatsApp number is the one they actually read.
    if (waPhone) {
      const wa = await sendWhatsappAck(tx, args, { phone: waPhone, values, ackText });
      sent = sent || wa;
    }

    if (!inv.email && !waPhone) {
      // Nobody to tell — leave an audited trace instead of dropping it silently.
      await tx.insert(communications).values({
        tenantId: args.tenantId,
        investorId: args.investorId,
        channel: "whatsapp",
        direction: "outbound",
        status: "skipped_no_contact",
        statusReason: "client has no phone or email on file — acknowledgement not sent",
        payload: { kind: "service_request_ack", serviceRequestId: args.srId, ticketNo: args.ticketNo },
      });
    }

    return { sent };
  } catch (err) {
    console.error("[sr-ack] non-fatal:", (err as Error).message);
    return { sent: false };
  }
}

type AckArgs = {
  tenantId: string;
  srId: string;
  ticketNo: string;
  type: string;
  investorId: string | null;
};

/** The acknowledgement by email — unchanged behaviour, now only when there is an email. */
async function sendEmailAck(
  tx: Tx,
  args: AckArgs,
  m: { email: string; lines: string[]; signoff: string; ackText: string }
): Promise<boolean> {
  const subject = `We've received your request — ${args.ticketNo}`;
  const gate = await gateClientSend(tx, {
    tenantId: args.tenantId,
    channel: "email",
    category: "transactional",
    text: m.ackText,
    subject,
    investorId: args.investorId,
  });
  if (!gate.allowed) {
    await tx.insert(communications).values({
      tenantId: args.tenantId,
      investorId: args.investorId,
      channel: "email",
      direction: "outbound",
      status: gate.reason === "compliance_blocked" ? "skipped_compliance" : "skipped_consent",
      statusReason: gate.detail,
      complianceSnapshot: (gate as any).findings ?? null,
      payload: { kind: "service_request_ack", serviceRequestId: args.srId, ticketNo: args.ticketNo } as any,
    } as any);
    return false;
  }

  let externalId: string | null = null;
  let status = "queued";
  const client = getResend();
  if (client) {
    try {
      const res = await client.emails.send({
        from: process.env.EMAIL_FROM_TRANSACTIONAL ?? "Equitywala <connect@ssit.com>",
        to: [m.email],
        subject,
        html: `<p>${m.lines.join("<br/>")}</p><p style="color:#64748b;font-size:12px">${m.signoff}</p>`,
      } as any);
      externalId = (res as any)?.data?.id ?? null;
      status = "sent";
    } catch {
      status = "queued";
    }
  } else {
    externalId = `dev_${uuid()}`;
    status = "sent";
  }

  await tx.insert(communications).values({
    tenantId: args.tenantId,
    investorId: args.investorId,
    channel: "email",
    direction: "outbound",
    status,
    externalId,
    consentSnapshot: gate.consentSnapshot as any,
    complianceSnapshot: gate.complianceFindings as any,
    complianceScore: String(gate.complianceScore) as any,
    payload: {
      kind: "service_request_ack",
      serviceRequestId: args.srId,
      ticketNo: args.ticketNo,
      type: args.type,
      text: m.ackText,
    } as any,
    sentAt: status === "sent" ? new Date() : null,
  } as any);
  return status === "sent";
}

/**
 * The acknowledgement on WhatsApp, through the normal comms pipeline (consent,
 * compliance, quota, audit row). Proactive messages need an approved Meta template, so
 * that goes first; with none approved yet it tries plain text (which only delivers
 * while the client's 24-hour window is open, e.g. when they just messaged us) and
 * provisions the template so the NEXT request delivers on its own.
 */
async function sendWhatsappAck(
  tx: Tx,
  args: AckArgs & { actorUserId?: string | null },
  m: { phone: string; values: { name: string; ticket: string; eta: string; firm: string }; ackText: string }
): Promise<boolean> {
  try {
    const rows = await tx
      .select({ key: templates.key, name: templates.name, locale: templates.locale, vars: templateVersions.variables })
      .from(templates)
      .innerJoin(templateVersions, eq(templateVersions.id, templates.currentVersionId))
      .where(
        and(
          eq(templates.tenantId, args.tenantId),
          eq(templates.channel, "whatsapp"),
          eq(templates.status, "approved")
        )
      );
    const tmpl =
      rows.find((r) => r.key === "service_request_received") ??
      rows.find((r) => SR_ACK_MATCHER.test(`${r.key} ${r.name}`)) ??
      null;

    const base = {
      tenantId: args.tenantId,
      channel: "whatsapp" as const,
      recipient: m.phone,
      category: "utility" as const,
      investorId: args.investorId ?? undefined,
      idempotencyKey: `sr-ack:${args.srId}`,
      meta: { kind: "service_request_ack", serviceRequestId: args.srId, ticketNo: args.ticketNo },
      // A background acknowledgement has no actor, so the sender shows as "automation".
      variables: {} as Record<string, unknown>,
    };

    let res;
    if (tmpl) {
      const keys = ((tmpl.vars as Array<{ key?: string }>) ?? []).map((v) => v?.key).filter((k): k is string => !!k);
      res = await dispatch(tx, {
        ...base,
        templateKey: tmpl.key,
        locale: tmpl.locale ?? undefined,
        variables: mapAckVariables(keys, m.values),
      });
    } else {
      res = await dispatch(tx, { ...base, freeformText: m.ackText });
      // No approved template yet — create it and send it to Meta for approval, in the
      // background (it can take a moment and must not slow down raising the request).
      void ensureServiceAckTemplate(args.tenantId, args.actorUserId ?? null);
    }
    return res.status === "sent" || res.status === "queued";
  } catch (err) {
    console.error("[sr-ack] whatsapp non-fatal:", (err as Error).message);
    return false;
  }
}
