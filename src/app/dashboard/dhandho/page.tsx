import Link from "next/link";
import { and, asc, eq, gt, gte, isNull, lte, sql } from "drizzle-orm";
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
const monthShort = (key: string) =>
  new Date(`${key}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });

export default async function DhandhoPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const session = await requireSession();
  const canManage = can(session.roles, "dhandho.manage", session.permissions);
  // Someone who may edit the rota can always see it.
  const canView = canManage || can(session.roles, "dhandho.view", session.permissions);
  if (!canView) {
    return (
      <div className="max-w-xl border rounded-lg bg-card p-8 text-sm text-muted-foreground">
        You do not have access to Dhandho. Ask an admin to turn on “Dhandho — view” for you.
      </div>
    );
  }

  const today = istDate();
  const thisMonth = today.slice(0, 7);
  const sp = await searchParams;
  const month = sp.m && isMonthKey(sp.m) ? sp.m : thisMonth;
  const grid = monthGrid(month);

  const { sessions, todaysRow, next, monthCounts } = await withTenant(session.tenantId, async (tx) => {
    const inGrid = await tx
      .select()
      .from(dhandhoSessions)
      .where(
        and(
          eq(dhandhoSessions.tenantId, session.tenantId),
          gte(dhandhoSessions.sessionDate, grid.from),
          lte(dhandhoSessions.sessionDate, grid.to)
        )
      )
      .orderBy(asc(dhandhoSessions.sessionDate));
    const [t] = await tx
      .select()
      .from(dhandhoSessions)
      .where(and(eq(dhandhoSessions.tenantId, session.tenantId), eq(dhandhoSessions.sessionDate, today)))
      .limit(1);
    // The next real session after today (skips holidays) — shown when today has none.
    const [n] = await tx
      .select()
      .from(dhandhoSessions)
      .where(
        and(
          eq(dhandhoSessions.tenantId, session.tenantId),
          gt(dhandhoSessions.sessionDate, today),
          isNull(dhandhoSessions.offReason)
        )
      )
      .orderBy(asc(dhandhoSessions.sessionDate))
      .limit(1);
    // Which months have a rota loaded, and how many speaker days each holds.
    const counts = await tx.execute(sql`
      SELECT to_char(session_date, 'YYYY-MM') AS m, COUNT(*) FILTER (WHERE off_reason IS NULL)::int AS n
        FROM dhandho_sessions
       WHERE tenant_id = ${session.tenantId}::uuid
       GROUP BY 1
       ORDER BY 1
    `);
    return {
      sessions: inGrid,
      todaysRow: t ?? null,
      next: n ?? null,
      monthCounts: counts.rows as Array<{ m: string; n: number }>,
    };
  });

  const todayOff = todaysRow?.offReason ?? null;
  const todays = todayOff ? null : todaysRow;
  const time = meetingTimeLabel(today);
  const iAmSpeaker = !!todays && todays.speakerUserId === session.userId;

  // Month chips: every month that has data, plus the one being viewed and this one.
  const loaded = new Map(monthCounts.map((r) => [r.m, r.n]));
  const chipKeys = [...new Set([...loaded.keys(), month, thisMonth])].sort();

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

      {/* Today's speaker, first thing on the page */}
      <div className={`rounded-xl border p-5 ${iAmSpeaker ? "border-amber-300 bg-amber-50" : "bg-card"}`}>
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Today · {dayName(today)}, {fmt(today)}
        </div>
        {time === null ? (
          <p className="mt-1 text-sm">No session on Sundays.</p>
        ) : todayOff ? (
          <p className="mt-1 text-sm">No session today — {todayOff}.</p>
        ) : todays ? (
          <>
            <div className="mt-1 text-2xl font-semibold">
              {iAmSpeaker ? "You are today's speaker" : todays.speakerName}
            </div>
            <div className="text-sm text-muted-foreground mt-0.5">
              {time}
              {todays.topic ? ` · ${todays.topic}` : ""}
            </div>
          </>
        ) : (
          <p className="mt-1 text-sm">No speaker has been added for today yet.</p>
        )}
        {(!todays || todayOff) && next && (
          <div className="mt-3 pt-3 border-t text-sm">
            <span className="text-muted-foreground">Next speaker: </span>
            <span className="font-medium">{next.speakerUserId === session.userId ? "You" : next.speakerName}</span>
            <span className="text-muted-foreground">
              {" "}
              · {dayName(next.sessionDate)}, {fmt(next.sessionDate)}
              {next.topic ? ` · ${next.topic}` : ""}
            </span>
          </div>
        )}
      </div>

      {/* Which month's rota this is */}
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <span className="text-muted-foreground">Month:</span>
        {chipKeys.map((k) => (
          <Link
            key={k}
            href={k === thisMonth ? "/dashboard/dhandho" : `/dashboard/dhandho?m=${k}`}
            className={`px-3 py-1.5 rounded-full border ${
              k === month ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent"
            }`}
          >
            {monthShort(k)}
            <span className={k === month ? "opacity-80" : "text-muted-foreground"}>
              {" "}
              · {loaded.has(k) ? `${loaded.get(k)} speaker days` : "no rota yet"}
            </span>
          </Link>
        ))}
      </div>

      <DhandhoCalendar
        month={month}
        sessions={sessions}
        today={today}
        userId={session.userId}
        canManage={canManage}
        thisMonth={thisMonth}
      />

      {canManage && (
        <details className="group" open={sessions.every((s) => !s.sessionDate.startsWith(month))}>
          <summary className="cursor-pointer text-sm font-medium text-brand-cyan hover:underline select-none">
            Manage the speaker rota (upload Excel, add a day)
          </summary>
          <div className="mt-3">
            <DhandhoAdmin />
          </div>
        </details>
      )}
    </div>
  );
}
