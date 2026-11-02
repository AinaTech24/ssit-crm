import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/dhandho/import  multipart/form-data: file=<xlsx|xls|csv>
 *
 * Loads a month of speakers. Columns: Date | Speaker | Topic (optional). A date
 * that already has a speaker is replaced. Past dates and Sundays are skipped and
 * reported, never silently dropped. Needs dhandho.manage.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { dhandhoSessions, users } from "@/db/schema";
import { istDate } from "@/lib/dhandho/schedule";
import { matchSpeaker, parseSheetFile, type SheetProblem } from "@/lib/dhandho/sheet";

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
    const today = istDate();
    const problems: SheetProblem[] = [...parsed.problems];

    // One entry per date — if the sheet repeats a date, the last row wins.
    const byDate = new Map<string, (typeof parsed.rows)[number]>();
    for (const r of parsed.rows) {
      if (r.date < today) {
        problems.push({ row: r.row, reason: `${r.date} is already in the past` });
        continue;
      }
      byDate.set(r.date, r);
    }

    const result = await withTenant(session.tenantId, async (tx) => {
      const people = await tx
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(eq(users.tenantId, session.tenantId));
      let saved = 0;
      const unmatched: string[] = [];
      for (const r of byDate.values()) {
        const u = matchSpeaker(r.speaker, people);
        if (!u) unmatched.push(r.speaker);
        await tx
          .insert(dhandhoSessions)
          .values({
            tenantId: session.tenantId,
            sessionDate: r.date,
            speakerUserId: u?.id ?? null,
            speakerName: u?.name ?? r.speaker,
            topic: r.topic,
            createdBy: session.userId,
          })
          .onConflictDoUpdate({
            target: [dhandhoSessions.tenantId, dhandhoSessions.sessionDate],
            set: {
              speakerUserId: u?.id ?? null,
              speakerName: u?.name ?? r.speaker,
              topic: r.topic,
              remindedAt: sql`CASE WHEN ${dhandhoSessions.speakerName} IS DISTINCT FROM ${u?.name ?? r.speaker} THEN NULL ELSE ${dhandhoSessions.remindedAt} END`,
              updatedAt: new Date(),
            },
          });
        saved++;
      }
      return { saved, unmatched: [...new Set(unmatched)] };
    });

    return NextResponse.json({ ...result, skipped: problems });
  } catch (err: any) {
    return handleApiError(err);
  }
}
