import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/amc-empanelments/meetings — create an AMC meeting from the list page.
 *
 * The caller picks an AMC by its catalogue code and name (the same picker the
 * empanelment form uses), so a firm with no empanelments yet can still record a
 * meeting. An AMC that has no empanelment row gets one on the spot, marked
 * "under review" so it does not pass for a signed-up house.
 *
 * Tagged colleagues (and everyone in a tagged branch) are told through an
 * announcement that only they — and the author — can see, plus an in-app
 * notification. Nobody else on the firm's board sees it.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { v4 as uuid } from "uuid";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { amcEmpanelments, amcMeetings, announcements, AMC_MEETING_MODES, AMC_MODE_LABEL } from "@/db/schema";

export const dynamic = "force-dynamic";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

const Body = z.object({
  amcCode: z.string().trim().min(1).max(60),
  amcName: z.string().trim().min(1).max(160),
  meetingDate: z.string().regex(ISO, "expected yyyy-mm-dd"),
  subject: z.string().trim().min(1).max(300),
  mode: z.enum(AMC_MEETING_MODES).nullish(),
  attendees: z.string().max(1000).nullish(),
  notes: z.string().max(8000).nullish(),
  followUp: z.string().max(2000).nullish(),
  collaboratorUserIds: z.array(z.string().uuid()).max(100).default([]),
  branchId: z.string().uuid().nullish(),
});

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["amc_meeting.view"], session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);

    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const b = parse.data;
    const meta = clientMetaFromHeaders(req.headers);
    const meetingId = uuid();

    const out = await withTenant(session.tenantId, async (tx) => {
      // The AMC's empanelment row — create one if this house has none yet.
      await tx
        .insert(amcEmpanelments)
        .values({
          id: uuid(),
          tenantId: session.tenantId,
          category: "mf",
          amcCode: b.amcCode,
          amcName: b.amcName,
          status: "under_review",
          remarks: "Added from an AMC meeting — not yet empanelled.",
          createdBy: session.userId,
        })
        .onConflictDoNothing();
      const [amc] = await tx
        .select({ id: amcEmpanelments.id, amcName: amcEmpanelments.amcName })
        .from(amcEmpanelments)
        .where(and(eq(amcEmpanelments.tenantId, session.tenantId), eq(amcEmpanelments.amcCode, b.amcCode)))
        .limit(1);
      if (!amc) throw Object.assign(new Error("AMC could not be added"), { status: 500 });

      // Only people who really are active in this firm can be tagged.
      const tagged = b.collaboratorUserIds.length
        ? (
            await tx.execute(sql`
              SELECT id FROM users
               WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active'
                 AND id IN (${sql.join(b.collaboratorUserIds.map((x) => sql`${x}::uuid`), sql`, `)})
            `)
          ).rows.map((r: any) => String(r.id))
        : [];
      const branchMembers = b.branchId
        ? (
            await tx.execute(sql`
              SELECT id FROM users
               WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active' AND branch_id = ${b.branchId}::uuid
            `)
          ).rows.map((r: any) => String(r.id))
        : [];
      const recipients = [...new Set([...tagged, ...branchMembers])].filter((id) => id !== session.userId);

      await tx.insert(amcMeetings).values({
        id: meetingId,
        tenantId: session.tenantId,
        amcEmpanelmentId: amc.id,
        meetingDate: b.meetingDate,
        subject: b.subject,
        mode: b.mode ?? null,
        attendees: b.attendees ?? null,
        notes: b.notes ?? null,
        followUp: b.followUp ?? null,
        collaboratorUserIds: tagged,
        branchId: b.branchId ?? null,
        createdByUserId: session.userId,
      });

      if (recipients.length) {
        const when = new Date(`${b.meetingDate}T00:00:00`).toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        });
        const lines = [
          [amc.amcName, when, b.mode ? AMC_MODE_LABEL[b.mode] : null].filter(Boolean).join(" · "),
          b.attendees ? `Attendees: ${clip(b.attendees, 160)}` : null,
          b.notes ? clip(b.notes.replace(/\s+/g, " "), 280) : null,
          b.followUp ? `Follow-up: ${clip(b.followUp, 160)}` : null,
        ].filter(Boolean) as string[];
        const title = `AMC meeting: ${clip(b.subject, 120)}`;
        // Stays on the banner until read; lapses two days after the meeting date.
        const expires = new Date(Math.max(Date.parse(`${b.meetingDate}T00:00:00Z`), Date.now()) + 2 * 86_400_000);
        const annId = uuid();
        await tx.insert(announcements).values({
          id: annId,
          tenantId: session.tenantId,
          title,
          body: lines.join("\n"),
          category: "amc_meeting",
          audienceRoles: [],
          audienceUserIds: recipients,
          isPinned: true,
          requiresAck: false,
          publishedAt: new Date(),
          expiresAt: expires,
          createdByUserId: session.userId,
        });
        const metaJson = JSON.stringify({ announcementId: annId, amcMeetingId: meetingId });
        await tx.execute(sql`
          INSERT INTO notifications (tenant_id, user_id, kind, title, body, link_url, severity, meta)
          SELECT ${session.tenantId}::uuid, u.id, 'amc_meeting.tagged', ${title}, ${lines[0] ?? ""},
                 '/dashboard/announcements', 'info', ${metaJson}::jsonb
            FROM users u
           WHERE u.tenant_id = ${session.tenantId}::uuid
             AND u.id IN (${sql.join(recipients.map((x) => sql`${x}::uuid`), sql`, `)})
        `);
      }

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "amc.meeting.create",
        entityType: "amc_empanelment",
        entityId: amc.id,
        after: { recordId: meetingId, amcName: amc.amcName, mode: b.mode ?? null, told: recipients.length },
        ...meta,
      });
      return { amcId: amc.id, told: recipients.length };
    });

    return NextResponse.json({ id: meetingId, ...out }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
