import Link from "next/link";
import { and, asc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { ChevronLeft, NotebookPen } from "lucide-react";
import { withTenant } from "@/db/client";
import { dhandhoSessions } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { DhandhoNotes } from "@/components/dhandho/DhandhoNotes";
import { dayName, isMonthKey, istDate, shiftMonth } from "@/lib/dhandho/schedule";

export const dynamic = "force-dynamic";

const fmt = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const monthLabel = (key: string) =>
  new Date(`${key}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
const monthShort = (key: string) =>
  new Date(`${key}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });

/**
 * All Dhandho notes, month by month. Every speaker day of the chosen month is listed -
 * past, today and upcoming - with its notes, and whoever may write notes (dhandho.notes,
 * or that day's own speaker) can add or change them for any of those days.
 */
export default async function DhandhoNotesPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const session = await requireSession();
  const canNotes = can(session.roles, "dhandho.notes", session.permissions);
  const canView =
    canNotes || can(session.roles, "dhandho.manage", session.permissions) || can(session.roles, "dhandho.view", session.permissions);
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
  const from = `${month}-01`;
  const to = `${shiftMonth(month, 1)}-01`;

  const { rows, months, authors } = await withTenant(session.tenantId, async (tx) => {
    const inMonth = await tx
      .select()
      .from(dhandhoSessions)
      .where(
        and(
          eq(dhandhoSessions.tenantId, session.tenantId),
          gte(dhandhoSessions.sessionDate, from),
          lt(dhandhoSessions.sessionDate, to),
          isNull(dhandhoSessions.offReason)
        )
      )
      .orderBy(asc(dhandhoSessions.sessionDate));
    const counts = await tx.execute(sql`
      SELECT to_char(session_date, 'YYYY-MM') AS m,
             COUNT(*)::int AS days,
             COUNT(*) FILTER (WHERE COALESCE(btrim(notes), '') <> '')::int AS notes
        FROM dhandho_sessions
       WHERE tenant_id = ${session.tenantId}::uuid AND off_reason IS NULL
       GROUP BY 1
       ORDER BY 1
    `);
    const authorIds = [...new Set(inMonth.map((s) => s.notesBy).filter(Boolean))] as string[];
    const names = new Map<string, string>();
    if (authorIds.length) {
      const r = await tx.execute(
        sql`SELECT id, name FROM users WHERE tenant_id = ${session.tenantId}::uuid AND id IN (${sql.join(authorIds.map((a) => sql`${a}::uuid`), sql`, `)})`
      );
      for (const u of r.rows as Array<{ id: string; name: string | null }>) names.set(String(u.id), u.name ?? "");
    }
    return { rows: inMonth, months: counts.rows as Array<{ m: string; days: number; notes: number }>, authors: names };
  });

  const info = new Map(months.map((r) => [r.m, r]));
  const chipKeys = [...new Set([...info.keys(), month, thisMonth])].sort().reverse();
  const when = (d: Date | null) =>
    d ? new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) : null;
  const mayWrite = (s: { speakerUserId: string | null }) => canNotes || (!!s.speakerUserId && s.speakerUserId === session.userId);
  const written = rows.filter((s) => !!s.notes?.trim()).length;

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <Link href="/dashboard/dhandho" className="text-sm text-muted-foreground hover:underline hover:text-foreground flex items-center gap-1">
          <ChevronLeft className="size-4" /> Back to Dhandho
        </Link>
        <h1 className="page-title flex items-center gap-2 mt-2">
          <NotebookPen className="size-6 text-brand-cyan" /> All notes
        </h1>
        <p className="page-subtitle mt-1">
          What was shared in each Dhandho session, month by month. Notes can be added or changed for earlier and upcoming
          sessions too.
        </p>
      </div>

      <div className="flex items-center gap-2 flex-wrap text-xs">
        <span className="text-muted-foreground">Month:</span>
        {chipKeys.map((k) => {
          const i = info.get(k);
          return (
            <Link
              key={k}
              href={`/dashboard/dhandho/notes?m=${k}`}
              className={`px-3 py-1.5 rounded-full border ${k === month ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent"}`}
            >
              {monthShort(k)}
              <span className={k === month ? "opacity-80" : "text-muted-foreground"}>
                {" "}
                · {i ? `${i.notes}/${i.days} noted` : "no schedule"}
              </span>
            </Link>
          );
        })}
      </div>

      <div className="space-y-3">
        <h2 className="section-title">
          {monthLabel(month)}
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {written} of {rows.length} sessions have notes
          </span>
        </h2>
        {rows.length === 0 ? (
          <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">No speaker days are scheduled in this month.</div>
        ) : (
          rows.map((s) => {
            const tag = s.sessionDate === today ? "Today" : s.sessionDate > today ? "Upcoming" : null;
            return (
              <div key={s.id} className="rounded-lg border bg-card p-4">
                <div className="flex items-center gap-2 flex-wrap text-sm font-semibold">
                  {dayName(s.sessionDate)}, {fmt(s.sessionDate)} · {s.speakerUserId === session.userId ? "You" : s.speakerName}
                  {s.topic ? <span className="font-normal text-muted-foreground"> · {s.topic}</span> : null}
                  {tag && <span className="chip text-[10px] bg-secondary text-foreground">{tag}</span>}
                </div>
                <DhandhoNotes
                  sessionId={s.id}
                  initialNotes={s.notes ?? null}
                  canEdit={mayWrite(s)}
                  writtenBy={s.notesBy ? authors.get(s.notesBy) ?? null : null}
                  writtenAt={when(s.notesAt ?? null)}
                  compact
                />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
