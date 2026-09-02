/**
 * Daily Job Tracker (DJT) — a per-RM daily reflection + planning ritual,
 * adopted from the MFD's Excel DJT. The "productive & completed" and
 * "non-productive & incomplete" lists auto-fill from the user's tasks; the RM
 * adds today's focus + key learning / breakdown / breakthrough. Owners can
 * review any team member's day (read-only) via ?user=.
 */

import Link from "next/link";
import { sql } from "drizzle-orm";
import { CalendarCheck, ListChecks, CheckCircle2, AlertCircle, TrendingUp, ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { withTenant } from "@/db/client";
import { loadDailyTracker } from "@/lib/daily-tracker";
import { DailyTrackerForm } from "@/components/tasks/DailyTrackerForm";
import { MyDayNav } from "@/components/layout/MyDayNav";

export const dynamic = "force-dynamic";

const PRIORITY_TONE: Record<string, string> = {
  urgent: "bg-rose-100 text-rose-700",
  high: "bg-amber-100 text-amber-700",
  normal: "bg-slate-100 text-slate-600",
  low: "bg-slate-100 text-slate-500",
};

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default async function DailyTrackerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const isOwner = can(session.roles, "dashboard.view.owner", session.permissions);

  const todayISO = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const dateISO =
    typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : todayISO;
  const targetUser = isOwner && sp.user ? sp.user : session.userId;
  const isSelf = targetUser === session.userId;
  const userQS = !isSelf ? `&user=${targetUser}` : "";

  const { data, name } = await withTenant(session.tenantId, async (tx) => {
    const data = await loadDailyTracker(tx as any, session.tenantId, targetUser, dateISO);
    const nameRow = await tx.execute(sql`SELECT name FROM users WHERE id = ${targetUser}::uuid LIMIT 1`);
    const name = ((nameRow.rows[0] as any)?.name as string) ?? "—";
    return { data, name };
  });

  const dateLabel = new Date(dateISO + "T00:00:00").toLocaleDateString("en-IN", {
    weekday: "long",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const isToday = dateISO === todayISO;
  const prevISO = addDays(dateISO, -1);
  const nextISO = addDays(dateISO, 1);
  const pct = Math.max(0, Math.min(100, Number(data.productivityPct) || 0));
  const pctTone = pct >= 75 ? "text-emerald-600" : pct >= 50 ? "text-amber-600" : "text-rose-600";
  const barTone = pct >= 75 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : "bg-rose-500";

  return (
    <div className="space-y-5 w-full">
      <MyDayNav />
      {/* Hero header */}
      <div className="rounded-2xl border border-border bg-gradient-to-br from-brand-cyan-light/50 via-card to-card p-5 sm:p-6">
        <Link href="/dashboard/tasks" className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1 mb-2">
          <ArrowLeft className="size-3" /> Back to Tasks
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <span className="grid place-items-center size-9 rounded-xl bg-brand-cyan text-white shadow-sm">
                <CalendarCheck className="size-5" />
              </span>
              Daily Job Tracker
            </h1>
            <p className="text-muted-foreground text-sm mt-1.5">
              {isSelf ? "Your day" : <><span className="font-medium text-foreground">{name}</span>'s day</>} · {dateLabel}
              {isToday && <span className="ml-2 inline-flex items-center rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 text-[10px] font-semibold">Today</span>}
            </p>
          </div>
          {/* Date navigation */}
          <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-card p-1">
            <Link href={`/dashboard/tasks/daily?date=${prevISO}${userQS}`} className="btn-icon size-7" title="Previous day" aria-label="Previous day">
              <ChevronLeft className="size-4" />
            </Link>
            <Link
              href={`/dashboard/tasks/daily${!isSelf ? `?user=${targetUser}` : ""}`}
              className={`rounded-md px-2.5 h-7 inline-flex items-center text-xs font-medium ${isToday ? "bg-brand-cyan text-white" : "hover:bg-secondary"}`}
            >
              Today
            </Link>
            <Link
              href={dateISO < todayISO ? `/dashboard/tasks/daily?date=${nextISO}${userQS}` : "#"}
              aria-disabled={dateISO >= todayISO}
              className={`btn-icon size-7 ${dateISO >= todayISO ? "pointer-events-none opacity-30" : ""}`}
              title="Next day"
              aria-label="Next day"
            >
              <ChevronRight className="size-4" />
            </Link>
          </div>
        </div>

        {/* Productivity hero + counts */}
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-1 rounded-xl bg-card border border-border p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground flex items-center gap-1.5"><TrendingUp className="size-3.5" /> Productivity</span>
            </div>
            <div className={`text-3xl font-bold mt-1 tabular-nums ${pctTone}`}>{pct}%</div>
            <div className="mt-2 h-2 rounded-full bg-secondary overflow-hidden">
              <div className={`h-full ${barTone} transition-all`} style={{ width: `${pct}%` }} />
            </div>
            <div className="text-[11px] text-muted-foreground mt-1.5">completed vs carried over</div>
          </div>
          <MiniStat icon={CheckCircle2} label="Completed yesterday" value={data.completedYesterday.length} tone="emerald" />
          <MiniStat icon={AlertCircle} label="Carried over" value={data.incompleteCarried.length} tone={data.incompleteCarried.length ? "amber" : "muted"} />
        </div>
      </div>

      {/* Auto-filled work lists */}
      <div className="grid md:grid-cols-2 gap-3">
        <WorkList
          title="Productive & completed"
          subtitle="yesterday"
          icon={CheckCircle2}
          accent="emerald"
          count={data.completedYesterday.length}
          empty="Nothing marked completed yesterday."
          items={data.completedYesterday.map((t) => ({ id: t.id, title: t.title, right: t.for ?? null }))}
        />
        <WorkList
          title="Non-productive & incomplete"
          subtitle="carried over"
          icon={ListChecks}
          accent="amber"
          count={data.incompleteCarried.length}
          empty="No overdue / carried-over tasks. 🎉"
          items={data.incompleteCarried.map((t) => ({
            id: t.id,
            title: t.title,
            rightBadge: t.priority,
          }))}
        />
      </div>

      {/* Editable: today's focus + reflection */}
      <DailyTrackerForm
        date={dateISO}
        readOnly={!isSelf}
        initial={{
          keyLearning: data.keyLearning,
          breakdown: data.breakdown,
          breakthrough: data.breakthrough,
          todayFocus: data.todayFocus,
        }}
        dueToday={data.dueToday}
      />
    </div>
  );
}

function MiniStat({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: any;
  label: string;
  value: number;
  tone: "emerald" | "amber" | "muted";
}) {
  const ring =
    tone === "emerald" ? "bg-emerald-100 text-emerald-600" : tone === "amber" ? "bg-amber-100 text-amber-600" : "bg-slate-100 text-slate-500";
  const num = tone === "emerald" ? "text-emerald-600" : tone === "amber" ? "text-amber-600" : "text-foreground";
  return (
    <div className="rounded-xl bg-card border border-border p-4 flex items-center gap-3">
      <span className={`grid place-items-center size-10 rounded-lg ${ring} shrink-0`}>
        <Icon className="size-5" />
      </span>
      <div className="min-w-0">
        <div className={`text-2xl font-bold tabular-nums leading-none ${num}`}>{value}</div>
        <div className="text-[11px] text-muted-foreground mt-1 truncate">{label}</div>
      </div>
    </div>
  );
}

function WorkList({
  title,
  subtitle,
  icon: Icon,
  accent,
  count,
  empty,
  items,
}: {
  title: string;
  subtitle: string;
  icon: any;
  accent: "emerald" | "amber";
  count: number;
  empty: string;
  items: Array<{ id: string; title: string; right?: string | null; rightBadge?: string }>;
}) {
  const head = accent === "emerald" ? "text-emerald-700" : "text-amber-700";
  const badge = accent === "emerald" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700";
  const bar = accent === "emerald" ? "bg-emerald-400" : "bg-amber-400";
  return (
    <section className="card-surface p-4 space-y-2.5">
      <div className="flex items-center justify-between">
        <h3 className={`text-sm font-semibold flex items-center gap-1.5 ${head}`}>
          <Icon className="size-4" /> {title}
          <span className="text-xs font-normal text-muted-foreground">· {subtitle}</span>
        </h3>
        <span className={`text-[11px] font-bold tabular-nums px-1.5 py-0.5 rounded-full ${badge} min-w-[1.4rem] text-center`}>{count}</span>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">{empty}</p>
      ) : (
        <ul className="space-y-1.5 max-h-72 overflow-y-auto scrollbar-thin pr-1">
          {items.map((t) => (
            <li key={t.id} className="relative pl-3 pr-2 py-1.5 rounded-md bg-secondary/30 flex items-center justify-between gap-2">
              <span className={`absolute left-0 top-1.5 bottom-1.5 w-1 rounded-full ${bar}`} aria-hidden />
              <span className="text-sm truncate">{t.title}</span>
              {t.rightBadge ? (
                <span className={`text-[10px] shrink-0 capitalize px-1.5 py-0.5 rounded ${PRIORITY_TONE[t.rightBadge] ?? "bg-slate-100 text-slate-600"}`}>{t.rightBadge}</span>
              ) : t.right ? (
                <span className="text-[11px] text-muted-foreground shrink-0 truncate max-w-[40%]">{t.right}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
