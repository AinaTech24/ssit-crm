import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/review-meetings/[id]/calendar.ics
 *
 * Returns a single-event iCalendar (.ics) file for the meeting so the RM (or
 * the client, if forwarded) can one-click add it to Google/Outlook/Apple
 * Calendar. Pure read; RLS-scoped via withTenant.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { reviewMeetings, investors, leads } from "@/db/schema";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  portfolio_review: "Portfolio Review",
  goal_review: "Goal Review",
  service_discussion: "Service Discussion",
  family_review: "Family Review",
  complaint_discussion: "Complaint Discussion",
  discovery_call: "Discovery Call",
  new_client_kickoff: "Client Kickoff",
  new_investment_discussion: "New Investment Discussion",
  product_demo: "Product Demo",
  sales_pitch: "Sales Pitch",
  follow_up_call: "Follow-up Call",
  follow_up_visit: "Follow-up Visit",
  other: "Meeting",
};

/** Format a Date as the iCalendar UTC stamp: YYYYMMDDTHHMMSSZ. */
function ics(dt: Date): string {
  return dt.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Escape text per RFC 5545 (commas, semicolons, backslashes, newlines). */
function esc(s: string): string {
  return (s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    const data = await withTenant(session.tenantId, async (tx) => {
      const m = (
        await tx.select().from(reviewMeetings).where(and(eq(reviewMeetings.id, id), eq(reviewMeetings.tenantId, session.tenantId))).limit(1)
      )[0];
      if (!m) return null;
      const inv = m.investorId
        ? (await tx.select().from(investors).where(eq(investors.id, m.investorId)).limit(1))[0]
        : null;
      const ld = m.leadId
        ? (await tx.select().from(leads).where(eq(leads.id, m.leadId)).limit(1))[0]
        : null;
      return { m, name: inv?.name ?? ld?.name ?? "Client" };
    });

    if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
    const { m, name } = data;

    const start = new Date(m.meetingDate);
    const durationMin = Number(m.durationMinutes ?? "30") || 30;
    const end = new Date(start.getTime() + durationMin * 60 * 1000);
    const title = m.subject
      ? `${m.subject} — ${name}`
      : `${TYPE_LABEL[m.meetingType] ?? "Meeting"} — ${name}`;
    const isUrl = !!m.locationOrLink && /^https?:\/\//i.test(m.locationOrLink);
    const descParts = [
      m.discussionPoints ? `Agenda: ${m.discussionPoints}` : "",
      `Mode: ${String(m.meetingMode).replace(/_/g, " ")}`,
      // Surface the video link in the body too — most calendar apps render a
      // clickable "Join" from the description even when LOCATION isn't tappable.
      isUrl ? `Join: ${m.locationOrLink}` : "",
    ].filter(Boolean);

    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//MFD CRM//Meetings//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      `UID:meeting-${m.id}@mfd-crm`,
      `DTSTAMP:${ics(new Date(m.createdAt ?? start))}`,
      `DTSTART:${ics(start)}`,
      `DTEND:${ics(end)}`,
      `SUMMARY:${esc(title)}`,
      `DESCRIPTION:${esc(descParts.join("\n"))}`,
      m.locationOrLink ? `LOCATION:${esc(m.locationOrLink)}` : "",
      "STATUS:CONFIRMED",
      // 1-hour-before pop-up reminder
      "BEGIN:VALARM",
      "TRIGGER:-PT1H",
      "ACTION:DISPLAY",
      `DESCRIPTION:${esc("Reminder: " + title)}`,
      "END:VALARM",
      "END:VEVENT",
      "END:VCALENDAR",
    ].filter(Boolean);

    const body = lines.join("\r\n");
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="meeting-${m.id.slice(0, 8)}.ics"`,
      },
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
