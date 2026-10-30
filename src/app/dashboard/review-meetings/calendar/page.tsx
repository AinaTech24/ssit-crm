import Link from "next/link";
import { CalendarClock, ArrowLeft } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can, requireAny } from "@/lib/auth/rbac";
import { isBackOfficeOnly } from "@/lib/auth/data-scope";
import { InteractiveCalendar } from "@/components/calendar/InteractiveCalendar";
import { getCalendarItems } from "@/lib/calendar/items";
import { loadDelegatedUserIds } from "@/lib/auth/data-scope";

export const dynamic = "force-dynamic";

/**
 * Meetings-only calendar.
 *
 * Deliberately reuses InteractiveCalendar rather than growing a second calendar
 * implementation — it already does month/week views, the day agenda drawer and
 * Monday-first cells. The only difference is the feed: everything except
 * scheduled meetings is filtered out, so this never shows tasks, SIP dates or
 * review-due reminders the way /dashboard/calendar does.
 *
 * The iCal button is intentionally hidden (icalSubscriptionUrl={null}): that
 * feed carries the user's WHOLE calendar, so offering it here would hand out a
 * subscription far broader than the view implies.
 */
export default async function MeetingsCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const session = await requireSession();
  requireAny(
    session.roles,
    ["review_meeting.manage.all", "review_meeting.manage.assigned"],
    session.permissions
  );

  const sp = await searchParams;
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const month = sp.month ?? `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  const [yyyy, mm] = month.split("-").map(Number);

  const monthStart = new Date(yyyy, mm - 1, 1);
  const lastDay = new Date(yyyy, mm, 0).getDate();
  // Build ISO bounds directly — toISOString() would shift the day on a server
  // running in a non-UTC timezone.
  const monthStartIso = `${yyyy}-${pad(mm)}-01`;
  const monthEndIso = `${yyyy}-${pad(mm)}-${pad(lastDay)}`;

  const all = await withTenant(session.tenantId, async (tx) =>
    getCalendarItems(tx, {
      fromIso: monthStartIso,
      toIso: monthEndIso,
      scope: {
        userId: session.userId,
        tasksAll: can(session.roles, "task.view.all", session.permissions),
        leadsAll: can(session.roles, "lead.view.all", session.permissions),
        investorsAll: can(session.roles, "investor.view.all", session.permissions),
        backOfficeOnly: isBackOfficeOnly(session.roles),
        // Meetings this user runs for a colleague (users.delegates_for) show on
        // their own calendar too — an EA books the partner's diary from here.
        delegatedUserIds: await loadDelegatedUserIds(tx, session.tenantId, session.userId),
      },
    })
  );
  // "meeting" is an actually-scheduled meeting; "review" is only an auto-computed
  // due-for-review reminder with no fixed time, so it stays out of this view.
  const items = all.filter((i) => i.kind === "meeting");

  const prevMonth = new Date(yyyy, mm - 2, 1);
  const nextMonth = new Date(yyyy, mm, 1);
  const monthLabel = monthStart.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  const thisMonth = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  const isCurrentMonth = month === thisMonth;
  const href = (d: Date) => `/dashboard/review-meetings/calendar?month=${d.getFullYear()}-${pad(d.getMonth() + 1)}`;

  return (
    <div className="space-y-6 max-w-7xl">
      <Link
        href="/dashboard/review-meetings"
        className="text-sm text-muted-foreground hover:underline hover:text-foreground inline-flex items-center gap-1 transition-colors"
      >
        <ArrowLeft className="size-4" /> Back to meetings
      </Link>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <CalendarClock className="size-6 text-brand-cyan" /> Meetings calendar
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Scheduled meetings only — {items.length} in {monthLabel}.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link href={href(prevMonth)} className="rounded-md border px-2.5 py-1.5 text-sm hover:bg-accent">
            ← {prevMonth.toLocaleDateString("en-IN", { month: "short" })}
          </Link>
          <div className="text-sm font-medium min-w-[140px] text-center">{monthLabel}</div>
          <Link href={href(nextMonth)} className="rounded-md border px-2.5 py-1.5 text-sm hover:bg-accent">
            {nextMonth.toLocaleDateString("en-IN", { month: "short" })} →
          </Link>
          {!isCurrentMonth && (
            <Link
              href="/dashboard/review-meetings/calendar"
              className="rounded-md border px-2.5 py-1.5 text-sm font-medium hover:bg-accent"
              title="Jump back to the current month"
            >
              Today
            </Link>
          )}
        </div>
      </div>

      <InteractiveCalendar
        initialItems={items}
        yyyy={yyyy}
        mm={mm}
        monthLabel={monthLabel}
        icalSubscriptionUrl={null}
      />
    </div>
  );
}
