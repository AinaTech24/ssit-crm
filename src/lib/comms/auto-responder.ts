/**
 * WhatsApp inbound AI auto-responder (human-in-the-loop).
 *
 * When a client WhatsApps the firm, this triages the message with AI — classifies
 * intent + urgency and drafts a reply — then notifies the right RM with the draft
 * ready to review and send. It deliberately does NOT auto-send unreviewed AI text
 * to clients: in a SEBI-regulated advisory business a human must approve anything
 * that goes out. So this is an "auto-responder assist": every inbound is instantly
 * triaged and routed, the RM gets a one-tap-editable reply, response time collapses.
 *
 * Fail-safe: any error here is swallowed (logged) so it can NEVER break inbound
 * message recording. No-op when no AI provider is configured (Equitywala Admin → AI &
 * Models, or env fallback), or when disabled via WA_AUTORESPONDER=off.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { triageInboundMessage } from "@/lib/ai/assistant";
import { isAiConfigured } from "@/lib/ai/provider";
import { createServiceRequest, detectServiceIntent } from "@/lib/service/create-request";

const URGENCY_TO_KIND: Record<string, string> = {
  high: "wa.inbound.urgent",
  normal: "wa.inbound",
  low: "wa.inbound",
};

export async function autoTriageInbound(params: {
  tx: Tx;
  tenantId: string;
  investorId: string | null;
  fromPhone: string;
  text: string;
}): Promise<void> {
  const { tx, tenantId, investorId, fromPhone, text } = params;

  // Disabled / empty → no-op (inbound is still recorded by the caller).
  if (process.env.WA_AUTORESPONDER === "off") return;
  if (!text.trim()) return;

  // ── CS4: WhatsApp service intake ─────────────────────────────────────────
  // Deterministic (no AI key needed): if a client's message is an actionable
  // service request ("send my statement", "pause my SIP", "change my bank"),
  // open a ticket with an instant ETA acknowledgement so nothing slips.
  try {
    if (investorId) {
      const intent = detectServiceIntent(text);
      if (intent) {
        const r = await tx.execute(sql`SELECT rm_id FROM investors WHERE id = ${investorId} LIMIT 1`);
        let assignee = (r.rows[0] as { rm_id: string | null } | undefined)?.rm_id ?? null;
        if (!assignee) {
          const o = await tx.execute(sql`
            SELECT id FROM users WHERE tenant_id = ${tenantId} AND 'owner' = ANY(roles) AND status = 'active'
            ORDER BY created_at ASC LIMIT 1
          `);
          assignee = (o.rows[0] as { id: string } | undefined)?.id ?? null;
        }
        await createServiceRequest(tx, {
          tenantId,
          investorId,
          type: intent.type,
          channel: "whatsapp",
          subject: intent.subject,
          description: text.slice(0, 500),
          priority: intent.type === "complaint" ? "high" : "normal",
          assignedToUserId: assignee,
          actorUserId: null,
          actorName: "WhatsApp intake",
        });
      }
    }
  } catch (err) {
    console.error("[wa-intake] non-fatal:", (err as Error).message);
  }

  // AI triage assist needs a configured model provider; the intake above does not.
  if (!(await isAiConfigured())) return;

  try {
    // Who should be notified — the investor's RM, else the tenant owner.
    let targetUserId: string | null = null;
    let investorName: string | null = null;
    if (investorId) {
      const r = await tx.execute(sql`
        SELECT rm_id, name FROM investors WHERE id = ${investorId} LIMIT 1
      `);
      const row = r.rows[0] as { rm_id: string | null; name: string | null } | undefined;
      targetUserId = row?.rm_id ?? null;
      investorName = row?.name ?? null;
    }
    if (!targetUserId) {
      const r = await tx.execute(sql`
        SELECT id FROM users WHERE tenant_id = ${tenantId} AND 'owner' = ANY(roles) AND status = 'active' ORDER BY created_at ASC LIMIT 1
      `);
      targetUserId = (r.rows[0] as { id: string } | undefined)?.id ?? null;
    }
    if (!targetUserId) return; // nobody to notify

    const triage = await triageInboundMessage({ text, investorName });
    if ("error" in triage) return; // AI hiccup — inbound already recorded, just skip the assist

    const who = investorName ?? fromPhone;
    const link = investorId ? `/dashboard/investors/${investorId}` : "/dashboard/communications";

    await tx.execute(sql`
      INSERT INTO notifications (id, tenant_id, user_id, kind, title, body, link_url, created_at, updated_at)
      VALUES (
        gen_random_uuid(), ${tenantId}, ${targetUserId},
        ${URGENCY_TO_KIND[triage.urgency] ?? "wa.inbound"},
        ${`WhatsApp from ${who}: ${triage.intent}`},
        ${`"${text.slice(0, 160)}"\n\nSuggested reply: ${triage.suggestedReply}`},
        ${link},
        now(), now()
      )
    `);
  } catch (err) {
    console.error("[wa-autoresponder] triage failed (non-fatal):", (err as Error).message);
  }
}
