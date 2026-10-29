/**
 * Tell the people around a service request that it has just been closed or
 * resolved. Shows as a pop-up (see PopupAlerts) and in the bell.
 *
 * Recipients: whoever raised the ticket, the person it is assigned to, and — when
 * it is tied to a client — that client's team (RM, service RM, branch heads,
 * hitesh@ / chirag@, see notifyClientTeam). The person who closed it is never told
 * about their own action.
 */

import { createNotification } from "./create";
import { notifyClientTeam } from "./client-team";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function becameFinished(before: string | null | undefined, after: string | null | undefined): boolean {
  const done = (s?: string | null) => s === "closed" || s === "resolved";
  return done(after) && !done(before);
}

export async function notifyServiceRequestFinished(
  tx: any,
  n: {
    tenantId: string;
    actorUserId: string;
    status: string;
    request: {
      id: string;
      ticketNo: string;
      subject: string;
      investorId: string | null;
      assignedToUserId: string | null;
      timeline?: Array<{ by: string }> | null;
    };
  }
): Promise<void> {
  try {
    const { request: r } = n;
    const verb = n.status === "resolved" ? "resolved" : "closed";
    const title = `Service request ${verb}: ${r.ticketNo}`;
    const body = r.subject;
    const linkUrl = `/dashboard/service-requests/${r.id}`;

    const to = new Set<string>();
    if (r.assignedToUserId) to.add(r.assignedToUserId);
    const raisedBy = r.timeline?.[0]?.by;
    if (raisedBy && UUID.test(raisedBy)) to.add(raisedBy);
    to.delete(n.actorUserId);

    for (const userId of to) {
      await createNotification(tx, {
        tenantId: n.tenantId,
        userId,
        kind: "service_request.closed",
        title,
        body,
        linkUrl,
        severity: "info",
        meta: { serviceRequestId: r.id, by: n.actorUserId },
      });
    }

    if (r.investorId) {
      await notifyClientTeam(tx, {
        tenantId: n.tenantId,
        investorId: r.investorId,
        actorUserId: n.actorUserId,
        kind: "service_request.closed",
        title: `${title} · {client}`,
        body,
        linkUrl,
        exclude: to,
      });
    }
  } catch (err) {
    // A missed heads-up must never fail the close itself.
    console.error("[notifyServiceRequestFinished] failed", err instanceof Error ? err.message : err);
  }
}
