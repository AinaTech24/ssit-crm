/**
 * Vartify webhook handler — https://vartify.in
 *
 * Receives, from the Vartify platform:
 *   - message.received  — a customer replied (the key event for CRM sync)
 *   - message.sent      — a message went out
 *   - contact.created / contact.updated / campaign.completed (acknowledged only)
 *
 * Security — Vartify signs every delivery:
 *   X-Webhook-Event      the event name
 *   X-Webhook-Signature  t=<unix_ts>,v1=<hmac_sha256>
 * where the signed value is `<t>.<raw body>` HMAC-SHA256'd with the endpoint
 * secret shown once at registration. We verify in constant time.
 *
 * Enforcement mirrors the previous provider's handling deliberately: when
 * VARTIFY_WEBHOOK_SECRET is set the signature MUST verify or we 401. When it is
 * unset we accept but log in production — so inbound WhatsApp doesn't go dark
 * during the window where only one side has been configured. An unverified
 * inbound path lets anyone who learns the URL forge messages, so set the secret.
 *
 * Idempotent by (external_id, channel).
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import { withSystem, withTenant } from "@/db/client";
import { communications, eventsOutbox, leads } from "@/db/schema";
import { applyMonotonicStatus } from "@/lib/comms/webhook-status";
import { autoTriageInbound } from "@/lib/comms/auto-responder";
import { captureError } from "@/lib/observability/capture";
import { vartifyWhatsappAdapter } from "@/lib/comms/adapters/vartify";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  // Signature gate. ENFORCED once VARTIFY_WEBHOOK_SECRET is set; see the file
  // docblock for why an unset secret accepts-with-a-warning rather than 503s.
  const secret = process.env.VARTIFY_WEBHOOK_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      captureError("webhook.secret_unconfigured", null, { source: "vartify" });
    }
    // accept through — do not drop inbound WhatsApp while unconfigured
  } else {
    const sig = req.headers.get("x-webhook-signature");
    if (!vartifyWhatsappAdapter.verifyWebhookSignature(rawBody, sig, secret)) {
      captureError("webhook.signature_failed", null, { source: "vartify" });
      return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  // Vartify names the event in a header; it also commonly repeats it in the
  // body. Trust the header first, fall back to the body.
  const event = (req.headers.get("x-webhook-event") ?? payload?.event ?? payload?.type ?? "").toString();
  const data = payload?.data ?? payload;

  try {
    switch (event) {
      case "message.received": {
        await handleInbound({
          from: data?.from ?? data?.contact?.phone_e164 ?? data?.phone_e164 ?? "",
          to: data?.to ?? data?.business_phone ?? data?.metadata?.display_phone_number ?? "",
          text: extractText(data),
          messageId: data?.provider_message_id ?? data?.message_id ?? data?.id ?? null,
          workspaceId: payload?.workspace_id ?? data?.workspace_id ?? null,
          raw: payload,
        });
        break;
      }
      case "message.sent": {
        // Outbound echo — advance our delivery status if it carries one.
        const status = String(data?.status ?? "sent").toLowerCase();
        await updateMessageStatus(
          data?.provider_message_id ?? data?.message_id ?? data?.id,
          status,
          data?.error?.code ?? data?.error_code
        );
        break;
      }
      case "contact.created":
      case "contact.updated":
      case "campaign.completed":
      case "automation.run.completed":
        // Acknowledged. The CRM is the system of record for contacts, so we
        // deliberately do NOT write these back — a Vartify-side edit must not
        // silently overwrite a client record here.
        break;
      default: {
        // Unknown/unhandled event, or a delivery-status shape we haven't seen.
        // Try the generic status path before giving up, then log it so an
        // unexpected payload is visible rather than silently dropped.
        const messageId = data?.provider_message_id ?? data?.message_id ?? data?.id;
        const status = String(data?.status ?? "").toLowerCase();
        if (messageId && status) {
          await updateMessageStatus(messageId, status, data?.error?.code ?? data?.error_code);
        } else if (event) {
          console.warn(`[webhook:vartify] unhandled event "${event}"`);
        }
      }
    }

    // Respond 2xx as soon as the event is stored — anything else is retried.
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[webhook:vartify]", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}

/** Pull the message text out of whichever field Vartify used. */
function extractText(d: any): string {
  return (
    d?.text ??
    d?.body ??
    d?.message ??
    d?.content ??
    d?.text?.body ??
    d?.interactive?.button_reply?.title ??
    d?.interactive?.list_reply?.title ??
    ""
  ).toString();
}

async function updateMessageStatus(externalId: string, status: string, errorCode?: string) {
  if (!externalId || !status) return;
  // Meta/Wapi statuses already match our enum (delivered/read/failed/sent).
  // Unknown statuses pass through; the monotonic helper treats them as rank 0.
  const ourStatus = status;

  await withSystem(async (tx) => {
    const rows = await applyMonotonicStatus(tx, {
      externalId,
      channel: "whatsapp",
      newStatus: ourStatus,
      reason: errorCode ?? null,
    });
    for (const row of rows) {
      if (!row.advanced) continue;
      await tx.insert(eventsOutbox).values({
        tenantId: row.tenantId,
        kind: `communication.${ourStatus}.whatsapp`,
        entityType: "communication",
        entityId: row.id,
        after: { external_id: externalId, status: ourStatus, error_code: errorCode },
      } as any);
    }
  });
}

/**
 * Which firm does this inbound belong to?
 *
 * Unlike the previous provider, a Vartify payload does not reliably carry the
 * receiving business number, so number-matching alone is not enough. Resolution
 * order:
 *   1. the receiving WA number → `whatsapp_numbers` (works when Vartify sends it)
 *   2. the Vartify workspace id → the tenant that saved it on its integration
 *   3. single-tenant shortcut: exactly one firm has Vartify connected, so the
 *      message can only be theirs
 * Returns null when genuinely ambiguous — the caller logs rather than guessing,
 * because attributing a client's message to the wrong firm is a data leak.
 */
async function resolveTenant(
  to: string,
  workspaceId?: string | number | null
): Promise<string | null> {
  return withSystem(async (tx) => {
    if (to) {
      const r = await tx.execute(sql`
        SELECT tenant_id FROM whatsapp_numbers WHERE phone_e164 = ${normalizePhone(to)} LIMIT 1
      `);
      const t = (r.rows[0] as any)?.tenant_id;
      if (t) return t as string;
    }

    if (workspaceId != null && String(workspaceId).trim()) {
      const r = await tx.execute(sql`
        SELECT tenant_id FROM tenant_integrations
        WHERE provider = 'vartify' AND is_active = true
          AND config->>'workspaceId' = ${String(workspaceId)}
        LIMIT 1
      `);
      const t = (r.rows[0] as any)?.tenant_id;
      if (t) return t as string;
    }

    const only = await tx.execute(sql`
      SELECT tenant_id FROM tenant_integrations
      WHERE provider = 'vartify' AND is_active = true
      LIMIT 2
    `);
    if (only.rows.length === 1) return (only.rows[0] as any).tenant_id as string;

    return null;
  });
}

async function handleInbound(msg: {
  from: string;
  to: string;
  text: string;
  messageId: string | null;
  workspaceId?: string | number | null;
  raw: any;
}) {
  const { from, to, text, messageId: providerMsgId, workspaceId, raw } = msg;
  if (!from) return;

  const tenantId = await resolveTenant(to, workspaceId);
  if (!tenantId) {
    // Never silently drop: an unroutable inbound means a real client message is
    // invisible in the CRM. Logged loudly so it can be traced to a missing
    // whatsapp_numbers row or an unmapped Vartify workspace.
    console.warn(
      `[webhook:vartify] could not resolve tenant (to="${to}", workspace="${workspaceId ?? ""}") — inbound from ${from} dropped`
    );
    captureError("webhook.tenant_unresolved", null, { source: "vartify", to, workspaceId: String(workspaceId ?? "") });
    return;
  }

  await withTenant(tenantId, async (tx) => {
    // Associate the inbound to a record: existing client (investor) first, then
    // an existing lead, otherwise AUTO-CREATE a lead so the conversation always
    // has a home (no orphaned inbound from an unknown number).
    const fromNorm = normalizePhone(from);
    const invRows = await tx.execute(sql`
      SELECT id FROM investors
      WHERE tenant_id = ${tenantId} AND (phone = ${from} OR whatsapp_phone = ${from})
      LIMIT 1
    `);
    let investorId: string | null = (invRows.rows[0] as any)?.id ?? null;
    let leadId: string | null = null;

    if (!investorId) {
      const leadRows = await tx.execute(sql`
        SELECT id FROM leads
        WHERE tenant_id = ${tenantId} AND (phone = ${from} OR phone_normalized = ${fromNorm})
        LIMIT 1
      `);
      leadId = (leadRows.rows[0] as any)?.id ?? null;

      if (!leadId) {
        const [created] = await tx
          .insert(leads)
          .values({
            tenantId,
            name: `WhatsApp: ${from}`,
            phone: from,
            phoneNormalized: fromNorm,
            source: "other",
            sourceCampaign: "WhatsApp inbound",
          } as any)
          .returning({ id: leads.id });
        leadId = created?.id ?? null;
      }
    }

    const commId = uuid();
    const inserted = await tx
      .insert(communications)
      .values({
        id: commId,
        tenantId,
        investorId,
        leadId,
        channel: "whatsapp",
        direction: "inbound",
        status: "delivered",
        externalId: providerMsgId ?? null,
        inboundContent: { text, raw, messageId: providerMsgId } as any,
        sentAt: new Date(),
      })
      .onConflictDoNothing()
      .returning({ id: communications.id });

    if (inserted.length === 0) return; // duplicate inbound delivery

    // Mark the most recent outbound to this subject as 'replied' (two-way thread).
    if (investorId || leadId) {
      const subjectCond = investorId ? sql`investor_id = ${investorId}` : sql`lead_id = ${leadId}`;
      await tx.execute(sql`
        UPDATE communications
        SET status = 'replied', replied_at = COALESCE(replied_at, now()), updated_at = now()
        WHERE id = (
          SELECT id FROM communications
          WHERE tenant_id = ${tenantId} AND ${subjectCond}
            AND channel = 'whatsapp' AND direction = 'outbound'
            AND status IN ('sent', 'delivered', 'read')
          ORDER BY created_at DESC
          LIMIT 1
        )
      `);
    }

    const isOptOut = /^(stop|unsubscribe|opt out|opt-out)$/i.test(text.trim());
    if (isOptOut && investorId) {
      await tx.execute(sql`
        INSERT INTO consents (id, tenant_id, investor_id, channel, scope, status, revoked_at, source, created_at, updated_at)
        VALUES (gen_random_uuid(), ${tenantId}, ${investorId}, 'whatsapp', 'marketing', 'revoked', now(), 'wa_optin', now(), now())
        ON CONFLICT (tenant_id, investor_id, channel, scope) DO UPDATE
        SET status = 'revoked', revoked_at = now(), updated_at = now()
      `);
    }

    await tx.insert(eventsOutbox).values({
      tenantId,
      kind: "inbound_message.whatsapp",
      entityType: "communication",
      entityId: commId,
      after: { from, text, investor_id: investorId, lead_id: leadId },
    } as any);

    // AI triage + RM routing applies to known clients (investors have an RM).
    if (!isOptOut && investorId) {
      await autoTriageInbound({ tx, tenantId, investorId, fromPhone: from, text });
    }
  });
}

function normalizePhone(num: string): string {
  let n = (num ?? "").replace(/[^\d+]/g, "");
  if (n.startsWith("+")) n = n.slice(1);
  if (n.length === 10) n = `91${n}`;
  return n;
}
