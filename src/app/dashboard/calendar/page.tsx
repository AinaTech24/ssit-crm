import Link from "next/link";
import { Calendar } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { isBackOfficeOnly } from "@/lib/auth/data-scope";
import { InteractiveCalendar } from "@/components/calendar/InteractiveCalendar";
import { getCalendarItems } from "@/lib/calendar/items";
import { loadDelegatedUserIds } from "@/lib/auth/data-scope";
import crypto from "node:crypto";
import { MyDayNav } from "@/components/layout/MyDayNav";

export const dynamic = "force-dynamic";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const now = new Date();
  const month = sp.month ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [yyyy, mm] = month.split("-").map(Number);

  const monthStart = new Date(yyyy, mm - 1, 1);
  // Build the ISO bounds directly (no toISOString, which would shift the day in
  // a non-UTC server timezone).
  const pad = (n: number) => String(n).padStart(2, "0");
  const lastDay = new Date(yyyy, mm, 0).getDate();
  const monthStartIso = `${yyyy}-${pad(mm)}-01`;
  const monthEndIso = `${yyyy}-${pad(mm)}-${pad(lastDay)}`;

  // Scope to the viewer's book (managers see the whole firm). RLS only isolates
  // by tenant — without this, every RM's calendar showed the entire firm.
  const items = await withTenant(session.tenantId, async (tx) =>
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

  const prevMonth = new Date(yyyy, mm - 2, 1);
  const nextMonth = new Date(yyyy, mm, 1);
  const monthLabel = monthStart.toLocaleDateString("en-IN", { month: "long", year: "numeric" });

  // iCal subscription link — signed per user. Fail closed: if no signing secret
  // is configured, hand out NO link rather than one keyed on a public default.
  const secret = process.env.NEXTAUTH_SECRET;
  const icalSubscriptionUrl = secret
    ? `${process.env.APP_URL ?? "http://localhost:3000"}/api/calendar/feed?userId=${session.userId}&token=${crypto
      .createHmac("sha256", secret)
      .update(session.userId)
      .digest("hex")}`
    : null;

  return (
    <div className="space-y-6 max-w-7xl">
      <MyDayNav />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Calendar className="size-6 text-brand-cyan" /> Calendar
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/dashboard/calendar?month=${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, "0")}`}
            className="rounded-md border px-2.5 py-1.5 text-sm hover:bg-accent"
          >
            ← {prevMonth.toLocaleDateString("en-IN", { month: "short" })}
          </Link>
          <div className="text-sm font-medium min-w-[140px] text-center">{monthLabel}</div>
          <Link
            href={`/dashboard/calendar?month=${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}`}
            className="rounded-md border px-2.5 py-1.5 text-sm hover:bg-accent"
          >
            {nextMonth.toLocaleDateString("en-IN", { month: "short" })} →
          </Link>
        </div>
      </div>

      <InteractiveCalendar
        initialItems={items}
        yyyy={yyyy}
        mm={mm}
        monthLabel={monthLabel}
        icalSubscriptionUrl={icalSubscriptionUrl}
      />
    </div>
  );
}
