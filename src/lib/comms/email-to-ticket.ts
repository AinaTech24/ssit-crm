/**
 * Email → Service Request auto-routing (parity with the WhatsApp intake).
 *
 * When an inbound client email expresses a recognised service intent ("send my
 * statement", "redeem", "update my bank"…), open a fully-formed, SLA-tracked,
 * auto-acknowledged ticket — reusing the SAME createServiceRequest path the
 * WhatsApp intake uses. Conservative by design: only fires for an email matched
 * to a known investor AND only when detectServiceIntent recognises a request, so
 * ordinary correspondence never spawns noise tickets. Idempotent because the
 * IMAP poller processes each message exactly once (externalId is unique).
 *
 * OFF unless EMAIL_TO_TICKET=on. Keyword matching on ordinary correspondence
 * ("SIP", "mutual fund", "statement") opened a stream of unwanted tickets, so
 * service requests are now created only by people, never from inbound email.
 */
import type { Tx } from "@/db/client";
import { createServiceRequest, detectServiceIntent } from "@/lib/service/create-request";

export async function maybeRouteEmailToTicket(
  tx: Tx,
  args: { tenantId: string; investorId: string | null; subject: string | null; text: string | null; messageId: string }
): Promise<void> {
  if (process.env.EMAIL_TO_TICKET !== "on") return;
  if (!args.investorId) return; // only auto-open for a known client
  const intent = detectServiceIntent(`${args.subject ?? ""}\n${args.text ?? ""}`);
  if (!intent) return;
  try {
    await createServiceRequest(tx, {
      tenantId: args.tenantId,
      investorId: args.investorId,
      type: intent.type,
      channel: "email",
      subject: (args.subject?.trim() || intent.subject).slice(0, 200),
      description: (args.text?.trim() || intent.subject).slice(0, 4000),
      actorName: "Email intake",
    });
  } catch (e) {
    // Non-fatal — the inbound email is already logged; ticket creation is a bonus.
    console.error("[email-to-ticket] failed:", (e as Error).message);
  }
}
