import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/dhandho — add (or replace) one day's speaker by hand.
 *
 * Body: { sessionDate: "YYYY-MM-DD", speakerUserId?: uuid, speakerName?: string, topic?: string }
 * Either a CRM user or a typed name. Needs dhandho.manage.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { dhandhoSessions, users } from "@/db/schema";
import { dayOfWeek, isIsoDate } from "@/lib/dhandho/schedule";

export const dynamic = "force-dynamic";

const Body = z.object({
  sessionDate: z.string().refine(isIsoDate, "Use a valid date"),
  speakerUserId: z.string().uuid().optional(),
  speakerName: z.string().trim().max(200).optional(),
  topic: z.string().trim().max(300).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "dhandho.manage", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Enter a valid date and a speaker." }, { status: 400 });
    const b = parsed.data;
    if (dayOfWeek(b.sessionDate) === 0) {
      return NextResponse.json({ error: "There is no session on a Sunday." }, { status: 400 });
    }

    const out = await withTenant(session.tenantId, async (tx) => {
      let speakerName = b.speakerName ?? "";
      let speakerUserId: string | null = null;
      if (b.speakerUserId) {
        const [u] = await tx
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(and(eq(users.id, b.speakerUserId), eq(users.tenantId, session.tenantId)))
          .limit(1);
        if (!u) return "bad_user" as const;
        speakerUserId = u.id;
        speakerName = u.name ?? speakerName;
      }
      if (!speakerName) return "no_speaker" as const;
      await tx
        .insert(dhandhoSessions)
        .values({
          tenantId: session.tenantId,
          sessionDate: b.sessionDate,
          speakerUserId,
          speakerName,
          topic: b.topic || null,
          createdBy: session.userId,
        })
        .onConflictDoUpdate({
          target: [dhandhoSessions.tenantId, dhandhoSessions.sessionDate],
          set: {
            speakerUserId,
            speakerName,
            topic: b.topic || null,
            // A changed speaker is announced again; the same one is not.
            remindedAt: sql`CASE WHEN ${dhandhoSessions.speakerName} IS DISTINCT FROM ${speakerName} THEN NULL ELSE ${dhandhoSessions.remindedAt} END`,
            updatedAt: new Date(),
          },
        });
      return "ok" as const;
    });

    if (out === "bad_user") return NextResponse.json({ error: "That person is not in this firm." }, { status: 400 });
    if (out === "no_speaker") return NextResponse.json({ error: "Choose or type a speaker." }, { status: 400 });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
