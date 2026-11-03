import { and, asc, eq, gte, lte } from "drizzle-orm";
import { Mic } from "lucide-react";
import { withTenant } from "@/db/client";
import { dhandhoSessions } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { DhandhoAdmin } from "@/components/dhandho/DhandhoAdmin";
import { DhandhoCalendar } from "./DhandhoCalendar";
import { dayName, isMonthKey, istDate, meetingTimeLabel, monthGrid } from "@/lib/dhandho/schedule";

export const dynamic = "force-dynamic";

const fmt = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export default async function DhandhoPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const session = await requireSession();
  const canManage = can(session.roles, "dhandho.manage", session.permissions);
  const today = istDate();
  const thisMonth = today.slice(0, 7);
  const sp = await searchParams;
  const month = sp.m && isMonthKey(sp.m) ? sp.m : thisMonth;
  const grid = monthGrid(month);

  const { sessions, todaysRow } = await withTenant(session.tenantId, async (tx) => ({
    // The whole visible grid, so the greyed days at the edges are right too.
    sessions: await tx
      .select()
      .from(dhandhoSessions)
      .where(
        and(
          eq(dhandhoSessions.tenantId, session.tenantId),
          gte(dhandhoSessions.sessionDate, grid.from),
          lte(dhandhoSessions.sessionDate, grid.to)
        )
      )
      .orderBy(asc(dhandhoSessions.sessionDate)),
    todaysRow:
      (
        await tx
          .select()
          .from(dhandhoSessions)
          .where(and(eq(dhandhoSessions.tenantId, session.tenantId), eq(dhandhoSessions.sessionDate, today)))
          .limit(1)
      )[0] ?? null,
  }));

  const todayOff = todaysRow?.offReason ?? null;
  const todays = todayOff ? null : todaysRow;
  const time = meetingTimeLabel(today);
  const iAmSpeaker = !!todays && todays.speakerUserId === session.userId;

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="page-title flex items-center gap-2">
          <Mic className="size-6 text-brand-cyan" /> Dhandho
        </h1>
        <p className="page-subtitle mt-1">
          The whole team meets every day — Monday to Friday at 10:00 am and Saturday at 10:30 am — and one person shares
          what they have learned.
        </p>
      </div>

      <div className={`rounded-xl border p-5 ${iAmSpeaker ? "border-amber-300 bg-amber-50" : "bg-card"}`}>
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Today</div>
        {time === null ? (
          <p className="mt-1 text-sm">No session on Sundays.</p>
        ) : todayOff ? (
          <p className="mt-1 text-sm">No session today — {todayOff}.</p>
        ) : todays ? (
          <>
            <div className="mt-1 text-lg font-semibold">
              {iAmSpeaker ? "You are today's speaker" : `Today's speaker: ${todays.speakerName}`}
            </div>
            <div className="text-sm text-muted-foreground">
              {dayName(today)}, {fmt(today)} · {time}
              {todays.topic ? ` · ${todays.topic}` : ""}
            </div>
          </>
        ) : (
          <p className="mt-1 text-sm">No speaker has been added for today yet.</p>
        )}
      </div>

      {canManage && <DhandhoAdmin />}

      <DhandhoCalendar
        month={month}
        sessions={sessions}
        today={today}
        userId={session.userId}
        canManage={canManage}
        thisMonth={thisMonth}
      />
    </div>
  );
}
