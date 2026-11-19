import { handleApiError } from "@/lib/api/error-handler";
/**
 * PUT /api/dhandho/[id]/notes — write (or change) the notes of one Dhandho session.
 *
 * Body: { notes: string, notify?: boolean }
 *
 * Who: someone holding dhandho.notes, or the speaker of THAT session. Only for a
 * session that has happened or is today (nothing to note about a future day), and not
 * on a holiday. When `notify` is true and the notes are not empty, every active member
 * gets an in-app notification carrying the day's topic and the notes.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { dhandhoSessions } from "@/db/schema";
import { createNotification } from "@/lib/notifications/create";
import { istDate } from "@/lib/dhandho/schedule";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

const Body = z.object({
  notes: z.string().max(5000),
  notify: z.boolean().optional(),
});

/** First lines of the notes, short enough for a notification body. */
function excerpt(text: string, max = 360): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const notes = parsed.data.notes.trim();
    const today = istDate();

    const result = await withTenant(session.tenantId, async (tx) => {
      const [row] = await tx
        .select()
        .from(dhandhoSessions)
        .where(and(eq(dhandhoSessions.id, id), eq(dhandhoSessions.tenantId, session.tenantId)))
        .limit(1);
      if (!row) return { error: "not found", status: 404 } as const;

      const holdsCap = can(session.roles, "dhandho.notes", session.permissions);
      const isSpeaker = !!row.speakerUserId && row.speakerUserId === session.userId;
      if (!holdsCap && !isSpeaker) return { error: "you cannot add notes to this session", status: 403 } as const;
      if (row.offReason) return { error: "there was no session on this day", status: 400 } as const;
      if (row.sessionDate > today) return { error: "this session has not happened yet", status: 400 } as const;

      await tx
        .update(dhandhoSessions)
        .set({
          notes: notes === "" ? null : notes,
          notesBy: notes === "" ? null : session.userId,
          notesAt: notes === "" ? null : new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(dhandhoSessions.id, id), eq(dhandhoSessions.tenantId, session.tenantId)));

      let notified = 0;
      if (parsed.data.notify && notes !== "") {
        const people = (
          await tx.execute(sql`
            SELECT id FROM users
             WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active' AND id <> ${session.userId}::uuid
          `)
        ).rows as Array<{ id: string }>;
        const isToday = row.sessionDate === today;
        const when = isToday
          ? "today"
          : new Date(`${row.sessionDate}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
        const heading = row.topic ? row.topic : `${row.speakerName}'s session`;
        for (const p of people) {
          await createNotification(tx, {
            tenantId: session.tenantId,
            userId: p.id,
            kind: "dhandho.notes",
            title: `Dhandho notes (${when}): ${heading}`,
            body: `${row.topic ? `Topic: ${row.topic}\n` : ""}${excerpt(notes)}`,
            linkUrl: "/dashboard/dhandho",
            severity: "info",
            meta: { sessionDate: row.sessionDate, sessionId: row.id },
          });
        }
        notified = people.length;
      }
      return { ok: true, notified } as const;
    });

    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
