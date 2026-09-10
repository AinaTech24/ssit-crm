import Link from "next/link";
import { CalendarDays, ArrowLeft, Plus } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { InteractiveCalendar } from "@/components/calendar/InteractiveCalendar";
import { getCalendarItems } from "@/lib/calendar/items";

export const dynamic = "force-dynamic";

/**
 * Tasks-only calendar — the same shape as the meetings calendar
 * (/dashboard/review-meetings/calendar), deliberately reusing
 * InteractiveCalendar rather than growing a third calendar implementation. It
 * already does month/week views, the day agenda drawer and Monday-first cells.
 *
 * The only difference is the feed: everything except tasks is filtered out, so
 * this never shows meetings, SIP debits or review reminders the way
 * /dashboard/calendar does.
 *
 * Scoping is getCalendarItems' own: managers (task.view.all) see the firm's
 * tasks, everyone else sees the ones they own or created — the same slice the
 * task list applies.
 *
 * The iCal button is intentionally hidden (icalSubscriptionUrl={null}): that
 * feed carries the user's WHOLE calendar, so offering it here would hand out a
 * subscription far broader than this view implies.
 */
export default async function TasksCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const session = await requireSession();

  const sp = await searchParams;
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const month = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
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
      },
    })
  );
  const items = all.filter((i) => i.kind === "task");

  const prevMonth = new Date(yyyy, mm - 2, 1);
  const nextMonth = new Date(yyyy, mm, 1);
  const monthLabel = monthStart.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  const thisMonth = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  const isCurrentMonth = month === thisMonth;
  const href = (d: Date) => `/dashboard/tasks/calendar?month=${d.getFullYear()}-${pad(d.getMonth() + 1)}`;

  return (
    <div className="space-y-6 max-w-7xl">
      <Link
        href="/dashboard/tasks"
        className="text-sm text-muted-foreground hover:underline hover:text-foreground inline-flex items-center gap-1 transition-colors"
      >
        <ArrowLeft className="size-4" /> Back to tasks
      </Link>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <CalendarDays className="size-6 text-brand-cyan" /> Tasks calendar
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Open tasks by due date — {items.length} in {monthLabel}.
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
              href="/dashboard/tasks/calendar"
              className="rounded-md border px-2.5 py-1.5 text-sm font-medium hover:bg-accent"
              title="Jump back to the current month"
            >
              Today
            </Link>
          )}
          <Link href="/dashboard/tasks/new" className="btn-primary text-sm inline-flex items-center gap-1.5">
            <Plus className="size-4" /> New task
          </Link>
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
