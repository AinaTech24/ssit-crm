/**
 * Tell the people named on a meeting that it exists.
 *
 * Booking a meeting for colleagues used to be silent: the row carried
 * collaborator_ids, the meeting showed up on their calendar if they went
 * looking, and nothing reached them. The person who booked it then had to
 * message everyone separately, which is the job the CRM was supposed to do.
 *
 * Sent as FIRM mail (the firm talking to its own staff), not through the comms
 * pipeline — that exists for client-facing messages and drags consent,
 * templates and the compliance gate behind it, none of which apply to telling
 * your own colleague about a diary entry.
 *
 * Best-effort by design: a meeting that is already saved must not fail because
 * a mailbox bounced, so every send is caught and counted rather than thrown.
 */

import { sql } from "drizzle-orm";
import { sendSystemEmail, actionEmailHtml } from "@/lib/comms/system-email";

export type MeetingForNotice = {
  id: string;
  subject: string | null;
  meetingType: string;
  meetingDate: Date;
  durationMinutes: string | number;
  meetingMode: string | null;
  locationOrLink: string | null;
  discussionPoints: string | null;
};

function formatWhen(d: Date): string {
  return d.toLocaleString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

const titleCase = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Emails every collaborator except the person who booked it — they know.
 *
 * Returns how many were emailed so the caller can surface it; never throws.
 */
export async function notifyMeetingCollaborators(
  tx: any,
  args: {
    tenantId: string;
    meeting: MeetingForNotice;
    collaboratorIds: string[];
    createdById: string | null;
    organiserName: string;
    /** Client / lead the meeting is about, when there is one. */
    aboutName?: string | null;
    baseUrl: string;
  }
): Promise<{ sent: number; skipped: number }> {
  const recipients = (args.collaboratorIds ?? []).filter(
    (id) => id && id !== args.createdById
  );
  if (recipients.length === 0) return { sent: 0, skipped: 0 };

  let rows: { id: string; name: string | null; email: string | null }[] = [];
  try {
    const r = await tx.execute(sql`
      SELECT id, name, email FROM users
      WHERE tenant_id = ${args.tenantId}::uuid
        AND status = 'active'
        AND id IN (${sql.join(
          recipients.map((u) => sql`${u}::uuid`),
          sql`, `
        )})
    `);
    rows = r.rows as typeof rows;
  } catch {
    return { sent: 0, skipped: recipients.length };
  }

  const m = args.meeting;
  const when = formatWhen(m.meetingDate);
  const what = m.subject?.trim() || titleCase(m.meetingType);
  const url = `${args.baseUrl}/dashboard/review-meetings/${m.id}`;

  const lines = [
    `${args.organiserName} has added you to a meeting.`,
    "",
    `What:  ${what}`,
    `When:  ${when} (${m.durationMinutes} minutes)`,
    args.aboutName ? `Client: ${args.aboutName}` : "",
    m.meetingMode ? `Mode:  ${titleCase(m.meetingMode)}` : "",
    m.locationOrLink ? `Where: ${m.locationOrLink}` : "",
    m.discussionPoints ? `\nAgenda:\n${m.discussionPoints}` : "",
    "",
    `Open it: ${url}`,
  ].filter((l) => l !== "");

  let sent = 0;
  let skipped = 0;
  for (const u of rows) {
    if (!u.email) {
      skipped++;
      continue;
    }
    try {
      const res = await sendSystemEmail({
        identity: "firm",
        tenantId: args.tenantId,
        to: u.email,
        subject: `Meeting: ${what} — ${when}`,
        text: lines.join("\n"),
        html: actionEmailHtml({
          heading: what,
          intro:
            `${args.organiserName} has added you to a meeting on ${when} ` +
            `(${m.durationMinutes} minutes)` +
            (args.aboutName ? ` about ${args.aboutName}` : "") +
            (m.locationOrLink ? `.<br/>Where: ${m.locationOrLink}` : ".") +
            (m.discussionPoints ? `<br/><br/><strong>Agenda</strong><br/>${m.discussionPoints}` : ""),
          buttonLabel: "Open the meeting",
          buttonUrl: url,
        }),
        // Per meeting AND per person, so re-running never double-sends to one
        // recipient but adding a new collaborator later still reaches them.
        idempotencyKey: `meeting-invite:${m.id}:${u.id}`,
      });
      if (res.sent) sent++;
      else skipped++;
    } catch {
      skipped++;
    }
  }
  return { sent, skipped };
}
