/**
 * A campaign is a "broadcast" (it actually sends messages to a segment) iff it
 * targets a channel + template + segment.
 *
 * `kind` is a marketing taxonomy (social / webinar / paid_ads / …) and must NOT
 * decide this — a real broadcast can carry kind 'content', 'paid_ads' or null.
 * The create route already uses this definition; launch + the dispatcher must
 * agree, or config-based broadcasts get silently marked "sent" (dispatcher) and
 * skip the approved-template gate (launch).
 */
export function isBroadcastCampaign(c: {
  channel?: string | null;
  templateId?: string | null;
  segmentId?: string | null;
}): boolean {
  return Boolean(c.channel && c.templateId && c.segmentId);
}
