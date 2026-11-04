import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { DhandhoSession } from "@/db/schema";
import { DeleteSessionButton } from "@/components/dhandho/DhandhoAdmin";
import { dayName, meetingTimeLabel, monthGrid, shiftMonth } from "@/lib/dhandho/schedule";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const monthTitle = (key: string) =>
  new Date(`${key}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
const dayOfMonth = (iso: string) => Number(iso.slice(8, 10));
const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

/**
 * The month's speaker schedule as a calendar — read-only for everyone; the
 * delete button on a day shows only for whoever manages the schedule. Weeks start
 * on Monday, like the meetings calendar. On a phone the grid is replaced by a
 * plain day-by-day list.
 */
export function DhandhoCalendar({
  month,
  sessions,
  today,
  userId,
  canManage,
  thisMonth,
}: {
  month: string;
  sessions: DhandhoSession[];
  today: string;
  userId: string;
  canManage: boolean;
  thisMonth: string;
}) {
  const grid = monthGrid(month);
  const byDate = new Map(sessions.map((s) => [s.sessionDate, s]));
  const inMonth = sessions.filter((s) => s.sessionDate.startsWith(month));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="section-title">{monthTitle(month)}</h2>
        <div className="flex items-center gap-1.5">
          <Link
            href={`/dashboard/dhandho?m=${shiftMonth(month, -1)}`}
            className="rounded-md border p-1.5 hover:bg-accent"
            aria-label="Previous month"
          >
            <ChevronLeft className="size-4" />
          </Link>
          {month !== thisMonth && (
            <Link href="/dashboard/dhandho" className="rounded-md border px-2.5 py-1 text-xs hover:bg-accent">
              This month
            </Link>
          )}
          <Link
            href={`/dashboard/dhandho?m=${shiftMonth(month, 1)}`}
            className="rounded-md border p-1.5 hover:bg-accent"
            aria-label="Next month"
          >
            <ChevronRight className="size-4" />
          </Link>
        </div>
      </div>

      {/* Phone: a day-by-day list */}
      <div className="sm:hidden border rounded-lg bg-card overflow-hidden">
        {inMonth.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">No speakers for this month yet.</div>
        ) : (
          <ul>
            {inMonth.map((s) => (
              <li
                key={s.id}
                className={`px-3 py-2 border-t first:border-t-0 text-sm ${
                  s.offReason ? "bg-rose-50/60 text-muted-foreground" : s.sessionDate === today ? "bg-primary/5" : ""
                }`}
              >
                <div className="text-xs text-muted-foreground">
                  {dayName(s.sessionDate)}, {shortDate(s.sessionDate)}
                  {!s.offReason && ` · ${meetingTimeLabel(s.sessionDate)}`}
                </div>
                {s.offReason ? (
                  <div className="font-medium">{s.offReason}</div>
                ) : (
                  <>
                    <div className="font-medium">{s.speakerUserId === userId ? "You" : s.speakerName}</div>
                    {s.topic && <div className="text-xs text-muted-foreground">{s.topic}</div>}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Desktop: the month grid */}
      <div className="hidden sm:block border rounded-lg bg-card overflow-hidden">
        <div className="grid grid-cols-7 bg-secondary/40 text-xs font-medium text-muted-foreground">
          {WEEKDAYS.map((d) => (
            <div key={d} className="px-2 py-2 text-center">{d}</div>
          ))}
        </div>
        {grid.weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7">
            {week.map(({ date, inMonth: inThisMonth, sunday }) => {
              const s = inThisMonth ? byDate.get(date) : undefined;
              const isToday = date === today;
              const mine = !!s && !s.offReason && s.speakerUserId === userId;
              return (
                <div
                  key={date}
                  className={`min-h-[112px] border-t border-l first:border-l-0 p-1.5 ${
                    !inThisMonth ? "bg-muted/30" : sunday ? "bg-secondary/30" : ""
                  }`}
                >
                  <div className="flex items-center justify-between h-6">
                    <span
                      className={
                        isToday
                          ? "size-6 rounded-full bg-red-600 text-white grid place-items-center text-xs font-bold"
                          : `text-xs ${inThisMonth ? "text-muted-foreground" : "text-muted-foreground/40"}`
                      }
                    >
                      {dayOfMonth(date)}
                    </span>
                    {canManage && s && <DeleteSessionButton id={s.id} />}
                  </div>
                  {s &&
                    (s.offReason ? (
                      <div className="mt-1 rounded-md bg-rose-100 text-rose-800 px-1.5 py-1 text-[11px] font-semibold text-center">
                        {s.offReason}
                      </div>
                    ) : (
                      <div
                        title={`${s.speakerName}${s.topic ? ` — ${s.topic}` : ""}`}
                        className={`mt-1 rounded-md border px-1.5 py-1 ${
                          mine ? "border-amber-300 bg-amber-50" : "border-brand-cyan/30 bg-brand-cyan-light/60"
                        }`}
                      >
                        <div className="text-[11px] font-semibold truncate">
                          {mine ? "You" : s.speakerName}
                        </div>
                        {s.topic && (
                          <div className="text-[10px] leading-snug text-muted-foreground line-clamp-3">{s.topic}</div>
                        )}
                      </div>
                    ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <p className="text-[11px] text-muted-foreground">
        Monday–Friday at 10:00 am, Saturday at 10:30 am. Pink days have no session.
      </p>
    </div>
  );
}
