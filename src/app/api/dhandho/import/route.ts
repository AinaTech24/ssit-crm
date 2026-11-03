import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/dhandho/import  multipart/form-data: file=<xlsx|xls|csv>
 *
 * Loads a month (or half a month) of speakers. Columns: Date | Name | Topic
 * (optional). The upload REPLACES the rota across the span the sheet covers: a
 * date it lists is overwritten, and a date inside that span that it does not list
 * is cleared. Days outside the span are left alone. Past dates are kept (the
 * calendar shows history); Sundays are reported, never silently dropped. Needs
 * dhandho.manage.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, gte, lte, notInArray, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { dhandhoSessions, users } from "@/db/schema";
import { matchSpeakerDetailed, parseSheetFile, sheetDateRange, type SheetProblem } from "@/lib/dhandho/sheet";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = 5 * 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "dhandho.manage", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);

    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!file || typeof file === "string") return NextResponse.json({ error: "Choose an Excel file." }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: "The file is larger than 5 MB." }, { status: 400 });

    let parsed;
    try {
      parsed = parseSheetFile(Buffer.from(await file.arrayBuffer()));
    } catch {
      return NextResponse.json({ error: "Could not read that file. Use .xlsx, .xls or .csv." }, { status: 400 });
    }
    const problems: SheetProblem[] = [...parsed.problems];

    // One entry per date — if the sheet repeats a date, the last row wins.
    const byDate = new Map<string, (typeof parsed.rows)[number]>();
    for (const r of parsed.rows) byDate.set(r.date, r);

    const result = await withTenant(session.tenantId, async (tx) => {
      const people = await tx
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(eq(users.tenantId, session.tenantId));
      let saved = 0;
      let offDays = 0;
      const unmatched: string[] = [];
      const matched: Array<{ sheetName: string; userName: string; how: string }> = [];
      for (const r of byDate.values()) {
        if (r.off) {
          // A day with no session: no speaker, no reminder.
          await tx
            .insert(dhandhoSessions)
            .values({
              tenantId: session.tenantId,
              sessionDate: r.date,
              speakerUserId: null,
              speakerName: r.off,
              topic: null,
              offReason: r.off,
              createdBy: session.userId,
            })
            .onConflictDoUpdate({
              target: [dhandhoSessions.tenantId, dhandhoSessions.sessionDate],
              set: { speakerUserId: null, speakerName: r.off, topic: null, offReason: r.off, updatedAt: new Date() },
            });
          offDays++;
          continue;
        }
        const m = matchSpeakerDetailed(r.speaker, people);
        const u = m?.user ?? null;
        if (!u) unmatched.push(r.speaker);
        else if (!matched.some((x) => x.sheetName === r.speaker)) {
          matched.push({ sheetName: r.speaker, userName: u.name ?? r.speaker, how: m!.how });
        }
        await tx
          .insert(dhandhoSessions)
          .values({
            tenantId: session.tenantId,
            sessionDate: r.date,
            speakerUserId: u?.id ?? null,
            speakerName: u?.name ?? r.speaker,
            topic: r.topic,
            offReason: null,
            createdBy: session.userId,
          })
          .onConflictDoUpdate({
            target: [dhandhoSessions.tenantId, dhandhoSessions.sessionDate],
            set: {
              speakerUserId: u?.id ?? null,
              speakerName: u?.name ?? r.speaker,
              topic: r.topic,
              offReason: null,
              remindedAt: sql`CASE WHEN ${dhandhoSessions.speakerName} IS DISTINCT FROM ${u?.name ?? r.speaker} THEN NULL ELSE ${dhandhoSessions.remindedAt} END`,
              updatedAt: new Date(),
            },
          });
        saved++;
      }
      // Override: clear any day inside the sheet's span that the sheet does not list.
      const span = sheetDateRange([...byDate.keys()]);
      let removed = 0;
      if (span) {
        const gone = await tx
          .delete(dhandhoSessions)
          .where(
            and(
              eq(dhandhoSessions.tenantId, session.tenantId),
              gte(dhandhoSessions.sessionDate, span.from),
              lte(dhandhoSessions.sessionDate, span.to),
              notInArray(dhandhoSessions.sessionDate, [...byDate.keys()])
            )
          )
          .returning({ id: dhandhoSessions.id });
        removed = gone.length;
      }
      return { saved, offDays, removed, span, matched, unmatched: [...new Set(unmatched)] };
    });

    return NextResponse.json({ ...result, skipped: problems });
  } catch (err: any) {
    return handleApiError(err);
  }
}
