import { and, asc, desc, eq, gte, lt } from "drizzle-orm";
import { Mic } from "lucide-react";
import { withTenant } from "@/db/client";
import { dhandhoSessions } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { DhandhoAdmin, DeleteSessionButton } from "@/components/dhandho/DhandhoAdmin";
import { dayName, istDate, meetingTimeLabel } from "@/lib/dhandho/schedule";

export const dynamic = "force-dynamic";

const fmt = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const monthOf = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

export default async function DhandhoPage() {
  const session = await requireSession();
  const canManage = can(session.roles, "dhandho.manage", session.permissions);
  const today = istDate();

  const { upcoming, recent } = await withTenant(session.tenantId, async (tx) => ({
    upcoming: await tx
      .select()
      .from(dhandhoSessions)
      .where(and(eq(dhandhoSessions.tenantId, session.tenantId), gte(dhandhoSessions.sessionDate, today)))
      .orderBy(asc(dhandhoSessions.sessionDate))
      .limit(120),
    recent: await tx
      .select()
      .from(dhandhoSessions)
      .where(and(eq(dhandhoSessions.tenantId, session.tenantId), lt(dhandhoSessions.sessionDate, today)))
      .orderBy(desc(dhandhoSessions.sessionDate))
      .limit(10),
  }));

  const todaysRow = upcoming.find((s) => s.sessionDate === today) ?? null;
  const todayOff = todaysRow?.offReason ?? null;
  const todays = todayOff ? null : todaysRow;
  const time = meetingTimeLabel(today);
  const iAmSpeaker = !!todays && todays.speakerUserId === session.userId;

  // Group the upcoming days by month.
  const months: Array<{ label: string; rows: typeof upcoming }> = [];
  for (const s of upcoming) {
    const label = monthOf(s.sessionDate);
    const last = months[months.length - 1];
    if (last && last.label === label) last.rows.push(s);
    else months.push({ label, rows: [s] });
  }

  return (
    <div className="space-y-6 max-w-4xl">
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

      <div className="space-y-4">
        <h2 className="section-title">Upcoming speakers</h2>
        {months.length === 0 ? (
          <div className="border rounded-lg bg-card p-8 text-center text-sm text-muted-foreground">
            No speakers scheduled yet.{canManage ? " Upload the month's Excel sheet above." : ""}
          </div>
        ) : (
          months.map((m) => (
            <div key={m.label} className="border rounded-lg bg-card overflow-hidden">
              <div className="px-4 py-2 text-xs font-semibold bg-secondary/50">{m.label}</div>
              <table className="w-full text-sm">
                <tbody>
                  {m.rows.map((s) => (
                    <tr
                      key={s.id}
                      className={`border-t ${s.offReason ? "bg-rose-50/60 text-muted-foreground" : s.sessionDate === today ? "bg-primary/5" : ""}`}
                    >
                      <td className="px-4 py-2 whitespace-nowrap">{fmt(s.sessionDate)}</td>
                      <td className="py-2 text-muted-foreground whitespace-nowrap">
                        {dayName(s.sessionDate)}
                        {s.offReason ? "" : ` · ${meetingTimeLabel(s.sessionDate)}`}
                      </td>
                      {s.offReason ? (
                        <td className="py-2 font-medium" colSpan={2}>{s.offReason}</td>
                      ) : (
                        <>
                          <td className="py-2 font-medium">{s.speakerName}</td>
                          <td className="py-2 text-muted-foreground">{s.topic ?? ""}</td>
                        </>
                      )}
                      <td className="py-2 pr-4 text-right">{canManage && <DeleteSessionButton id={s.id} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))
        )}
      </div>

      {recent.length > 0 && (
        <div className="space-y-2">
          <h2 className="section-title">Recent sessions</h2>
          <div className="border rounded-lg bg-card overflow-hidden">
            <table className="w-full text-sm">
              <tbody>
                {recent.filter((s) => !s.offReason).map((s) => (
                  <tr key={s.id} className="border-t first:border-t-0">
                    <td className="px-4 py-2 whitespace-nowrap">{fmt(s.sessionDate)}</td>
                    <td className="py-2 font-medium">{s.speakerName}</td>
                    <td className="py-2 pr-4 text-muted-foreground">{s.topic ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
