/**
 * "They subscribed, so they are a client."
 *
 * A research lead moved to the SUBSCRIBED category is converted by the same
 * route a person would use from the lead page, so there is exactly one
 * conversion path - risk-profile / proposal / document / meeting carry-over,
 * the outbox events and the blueprint hand-off all happen the same way - rather
 * than a second, thinner copy that drifts.
 *
 * The convert handler authenticates from the ambient request (next/headers), so
 * the synthetic request here only supplies the body and audit metadata.
 */

import { NextRequest } from "next/server";
import { POST as convertLead } from "@/app/api/leads/[id]/convert/route";

export type AutoConvertResult = { converted: boolean; investorId?: string; error?: string };

export async function autoConvertLead(req: NextRequest, leadId: string): Promise<AutoConvertResult> {
  try {
    const headers = new Headers(req.headers);
    headers.delete("content-length");
    headers.set("content-type", "application/json");
    const synthetic = new NextRequest(new URL(`/api/leads/${leadId}/convert`, req.url), {
      method: "POST",
      headers,
      body: "{}",
    });
    const res = await convertLead(synthetic, { params: Promise.resolve({ id: leadId }) });
    const j = (await res.json().catch(() => ({}))) as { investorId?: string; error?: string };
    if (!res.ok) return { converted: false, error: j.error ?? `convert failed (${res.status})` };
    return { converted: true, investorId: j.investorId };
  } catch (err) {
    // The lead itself is saved; a failed conversion must not undo that.
    return { converted: false, error: err instanceof Error ? err.message : "convert failed" };
  }
}
