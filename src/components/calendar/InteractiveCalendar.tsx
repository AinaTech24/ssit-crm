"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";
import {
  Calendar as CalendarIcon,
  CalendarClock,
  ListChecks,
  Sparkles,
  Users,
  Repeat,
  Megaphone,
  ShieldCheck,
  X,
  Copy,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
} from "lucide-react";

/**
 * Format a Date as YYYY-MM-DD in the *local* calendar, not UTC.
 *
 * `date.toISOString().slice(0, 10)` was used here and is wrong for every
 * timezone east of UTC: a cell built as local midnight (e.g. 2 Jul 00:00 IST)
 * converts to 1 Jul 18:30Z, so the day key came out one day early. That shifted
 * the whole grid — each cell listed the previous day's items and the agenda
 * drawer was titled with the previous day's date.
 */
function localISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Parse a YYYY-MM-DD key back to local midnight (`new Date("…")` is UTC). */
function parseLocalISODate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

type Item = {
  date: string; // YYYY-MM-DD
  kind: "task" | "follow_up" | "meeting" | "review" | "sip" | "campaign" | "compliance";
  title: string;
  href: string;
  meta?: string;
  subjectType?: "investor" | "lead";
  subjectId?: string;
  avatarUrl?: string | null;
  personName?: string;
};

const KIND_META: Record<Item["kind"], { color: string; icon: any; label: string }> = {
  task: { color: "bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100/70 dark:bg-amber-950/50 dark:text-amber-200 dark:border-amber-900 dark:hover:bg-amber-950/70", icon: ListChecks, label: "Task" },
  follow_up: { color: "bg-blue-50 text-blue-800 border-blue-200 hover:bg-blue-100/70 dark:bg-blue-950/50 dark:text-blue-200 dark:border-blue-900 dark:hover:bg-blue-950/70", icon: Sparkles, label: "Follow-up" },
  // Actually-scheduled meetings (Meetings module) — distinct from "review"
  // below, which is only an auto-computed "due for review" reminder date and
  // has no fixed time.
  meeting: { color: "bg-cyan-50 text-cyan-800 border-cyan-200 hover:bg-cyan-100/70 dark:bg-cyan-950/50 dark:text-cyan-200 dark:border-cyan-900 dark:hover:bg-cyan-950/70", icon: CalendarClock, label: "Meeting" },
  review: { color: "bg-violet-50 text-violet-800 border-violet-200 hover:bg-violet-100/70 dark:bg-violet-950/50 dark:text-violet-200 dark:border-violet-900 dark:hover:bg-violet-950/70", icon: Users, label: "Review due" },
  sip: { color: "bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100/70 dark:bg-emerald-950/50 dark:text-emerald-200 dark:border-emerald-900 dark:hover:bg-emerald-950/70", icon: Repeat, label: "SIP" },
  campaign: { color: "bg-pink-50 text-pink-800 border-pink-200 hover:bg-pink-100/70 dark:bg-pink-950/50 dark:text-pink-200 dark:border-pink-900 dark:hover:bg-pink-950/70", icon: Megaphone, label: "Campaign" },
  compliance: { color: "bg-rose-50 text-rose-800 border-rose-200 hover:bg-rose-100/70 dark:bg-rose-950/50 dark:text-rose-200 dark:border-rose-900 dark:hover:bg-rose-950/70", icon: ShieldCheck, label: "Compliance" },
};

interface InteractiveCalendarProps {
  initialItems: Item[];
  yyyy: number;
  mm: number;
  monthLabel: string;
  /** null when the server can't sign a feed token (NEXTAUTH_SECRET unset) —
   *  the "Sync to Calendar" button is hidden rather than handing out a
   *  forgeable/broken link. */
  icalSubscriptionUrl: string | null;
}

export function InteractiveCalendar({
  initialItems,
  yyyy,
  mm,
  monthLabel,
  icalSubscriptionUrl,
}: InteractiveCalendarProps) {
  const [viewMode, setViewMode] = useState<"month" | "week">("month");
  const [activeFilters, setActiveFilters] = useState<Set<Item["kind"]>>(() => new Set(Object.keys(KIND_META) as Item["kind"][]));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // The agenda drawer is portalled to <body>; that's only possible after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Week View navigation
  const getStartOfWeek = (d: Date) => {
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
    return new Date(d.setDate(diff));
  };

  const [weekStart, setWeekStart] = useState(() => {
    const today = new Date();
    // If today is in the active yyyy/mm, start with today. Else start with the first day of that month.
    if (today.getFullYear() === yyyy && today.getMonth() === mm - 1) {
      return getStartOfWeek(new Date());
    }
    return getStartOfWeek(new Date(yyyy, mm - 1, 1));
  });

  const handleCopyLink = async () => {
    if (!icalSubscriptionUrl) return;
    try {
      await navigator.clipboard.writeText(icalSubscriptionUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error(err);
    }
  };

  const toggleFilter = (k: Item["kind"]) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(k)) {
        next.delete(k);
      } else {
        next.add(k);
      }
      return next;
    });
  };

  // Filter items
  const filteredItems = initialItems.filter((it) => activeFilters.has(it.kind));

  // Compute month cells (Monday-first)
  const monthStart = new Date(yyyy, mm - 1, 1);
  const monthEnd = new Date(yyyy, mm, 0);
  const firstWeekday = (monthStart.getDay() + 6) % 7;
  const daysInMonth = monthEnd.getDate();

  const monthCells: Array<{ date: Date | null; items: Item[] } | null> = [];
  for (let i = 0; i < firstWeekday; i++) monthCells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(yyyy, mm - 1, d);
    const iso = localISODate(date);
    monthCells.push({ date, items: filteredItems.filter((it) => it.date === iso) });
  }
  while (monthCells.length % 7 !== 0) monthCells.push(null);

  // Compute week cells (Monday to Sunday)
  const weekDays: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    weekDays.push(d);
  }

  const navigateWeek = (weeks: number) => {
    setWeekStart((prev) => {
      const next = new Date(prev);
      next.setDate(next.getDate() + weeks * 7);
      return next;
    });
  };

  // Drawer items
  const drawerItems = selectedDay ? filteredItems.filter((it) => it.date === selectedDay) : [];

  return (
    <div className="space-y-4">
      {/* Calendar Control Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white border p-3 rounded-lg shadow-sm">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setViewMode("month")}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold border transition-all ${
              viewMode === "month"
                ? "bg-brand-cyan text-white border-brand-cyan shadow-sm"
                : "border-border text-muted-foreground hover:bg-secondary"
            }`}
          >
            Month View
          </button>
          <button
            onClick={() => setViewMode("week")}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold border transition-all ${
              viewMode === "week"
                ? "bg-brand-cyan text-white border-brand-cyan shadow-sm"
                : "border-border text-muted-foreground hover:bg-secondary"
            }`}
          >
            Week View
          </button>
        </div>

        {viewMode === "week" && (
          <div className="flex items-center justify-center gap-2">
            <button
              onClick={() => navigateWeek(-1)}
              className="rounded-md border p-1 hover:bg-secondary"
              title="Previous Week"
            >
              <ChevronLeft className="size-4" />
            </button>
            <span className="text-xs font-medium min-w-[170px] text-center">
              Week of {weekDays[0].toLocaleDateString("en-IN", { day: "numeric", month: "short" })} –{" "}
              {weekDays[6].toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
            </span>
            <button
              onClick={() => navigateWeek(1)}
              className="rounded-md border p-1 hover:bg-secondary"
              title="Next Week"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        )}

        {icalSubscriptionUrl && (
          <button
            onClick={handleCopyLink}
            className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5 self-end sm:self-auto"
            title="Sync this rolling calendar feed to Google Calendar, Apple, or Outlook"
          >
            {copied ? <Check className="size-3.5 text-emerald-600" /> : <Repeat className="size-3.5 text-brand-cyan" />}
            {copied ? "Link Copied!" : "Sync to Calendar"}
          </button>
        )}
      </div>

      {/* Empty month → teach the first step instead of showing a bare grid. */}
      {initialItems.length === 0 && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-secondary/40 px-4 py-2.5 text-sm">
          <span className="text-muted-foreground">
            Nothing scheduled this month — reviews, follow-ups, SIP dates and birthdays all land here automatically.
          </span>
          <a href="/dashboard/review-meetings/new" className="btn-primary text-xs whitespace-nowrap shrink-0">
            Schedule a review
          </a>
        </div>
      )}

      {/* Legend Filtering Badges */}
      <div className="flex flex-wrap gap-2 text-xs">
        {Object.entries(KIND_META).map(([k, meta]) => {
          const count = initialItems.filter((it) => it.kind === k).length;
          const Icon = meta.icon;
          const isActive = activeFilters.has(k as Item["kind"]);
          return (
            <button
              key={k}
              onClick={() => toggleFilter(k as Item["kind"])}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-full border transition-all select-none cursor-pointer ${
                isActive
                  ? `${meta.color} ring-1 ring-black/5`
                  : "bg-slate-50 text-slate-400 border-slate-200 line-through opacity-60 hover:opacity-85"
              }`}
            >
              <Icon className="size-3 flex-shrink-0" />
              <span className="font-medium">{meta.label}</span>
              <span className="opacity-70 font-mono">· {count}</span>
            </button>
          );
        })}
      </div>

      {/* Main Grid View */}
      {viewMode === "month" ? (
        <div className="border rounded-lg bg-card overflow-hidden bg-white shadow-sm">
          <div className="grid grid-cols-7 border-b text-xs font-bold text-slate-500 bg-slate-50">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
              <div key={d} className="px-3 py-2 text-center border-r last:border-r-0">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {monthCells.map((cell, i) => {
              const isToday = cell?.date && cell.date.toDateString() === new Date().toDateString();
              const iso = cell?.date ? localISODate(cell.date) : "";

              return (
                <div
                  key={i}
                  onClick={() => cell && setSelectedDay(iso)}
                  className={`border-r border-b min-h-[120px] p-2 hover:bg-slate-50/50 transition-colors ${
                    cell ? "cursor-pointer" : "bg-slate-50/20"
                  } ${isToday ? "bg-blue-50/40 border-blue-200" : "border-slate-100"}`}
                >
                  {cell && (
                    <>
                      <div className="flex items-center justify-between">
                        <span
                          className={`text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center ${
                            isToday ? "bg-brand-cyan text-white shadow-sm" : "text-slate-400"
                          }`}
                        >
                          {cell.date!.getDate()}
                        </span>
                        {cell.items.length > 0 && (
                          <span className="text-[10px] font-bold text-slate-400 font-mono">
                            {cell.items.length}
                          </span>
                        )}
                      </div>
                      <div className="mt-1.5 space-y-1">
                        {cell.items.slice(0, 3).map((it, idx) => {
                          const meta = KIND_META[it.kind];
                          return (
                            <div
                              key={idx}
                              className={`text-[10px] truncate rounded px-1.5 py-0.5 border ${meta.color} font-medium flex items-center gap-1`}
                              title={`${meta.label}: ${it.title}`}
                            >
                              {it.subjectId && (
                                <Avatar src={it.avatarUrl ? `/api/${it.subjectType === "lead" ? "leads" : "investors"}/${it.subjectId}/avatar` : null} name={it.personName ?? it.title} size={14} />
                              )}
                              <span className="truncate">{it.title}</span>
                            </div>
                          );
                        })}
                        {cell.items.length > 3 && (
                          <div className="text-[9px] text-brand-cyan font-bold px-1 mt-0.5">
                            + {cell.items.length - 3} more
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* Week View Grid */
        <div className="border rounded-lg bg-card overflow-hidden bg-white shadow-sm">
          <div className="grid grid-cols-7 border-b text-xs font-bold text-slate-500 bg-slate-50">
            {weekDays.map((d) => {
              const isToday = d.toDateString() === new Date().toDateString();
              return (
                <div
                  key={d.toISOString()}
                  className={`px-3 py-3 text-center border-r last:border-r-0 flex flex-col items-center gap-0.5 ${
                    isToday ? "bg-blue-50/40 text-brand-cyan-deep" : ""
                  }`}
                >
                  <span>{d.toLocaleDateString("en-IN", { weekday: "short" })}</span>
                  <span
                    className={`text-xs font-extrabold w-5 h-5 rounded-full flex items-center justify-center ${
                      isToday ? "bg-brand-cyan text-white shadow-sm" : "text-slate-400"
                    }`}
                  >
                    {d.getDate()}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="grid grid-cols-7 divide-x divide-slate-100 min-h-[350px]">
            {weekDays.map((day) => {
              const iso = localISODate(day);
              const dayItems = filteredItems.filter((it) => it.date === iso);
              const isToday = day.toDateString() === new Date().toDateString();

              return (
                <div
                  key={iso}
                  onClick={() => setSelectedDay(iso)}
                  className={`p-2 space-y-1.5 cursor-pointer hover:bg-slate-50/40 transition-colors ${
                    isToday ? "bg-blue-50/10" : ""
                  }`}
                >
                  {dayItems.length === 0 ? (
                    <div className="text-[10px] text-slate-300 italic text-center mt-12 select-none">
                      No events
                    </div>
                  ) : (
                    dayItems.map((it, idx) => {
                      const meta = KIND_META[it.kind];
                      return (
                        <div
                          key={idx}
                          className={`text-[10px] rounded p-1.5 border leading-tight ${meta.color} font-medium flex flex-col gap-0.5 shadow-sm`}
                          title={`${meta.label}: ${it.title}`}
                        >
                          <span className="font-semibold flex items-center gap-1">
                            {it.subjectId && (
                              <Avatar src={it.avatarUrl ? `/api/${it.subjectType === "lead" ? "leads" : "investors"}/${it.subjectId}/avatar` : null} name={it.personName ?? it.title} size={16} />
                            )}
                            <span className="truncate">{it.title}</span>
                          </span>
                          {it.meta && <span className="opacity-75 text-[9px] font-normal font-mono truncate">{it.meta}</span>}
                        </div>
                      );
                    })
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Day Details Drawer Sidebar.
          Portalled to <body> and given a z-index above the dashboard topbar
          (which is `sticky z-40`). Rendered in place, the backdrop sat inside
          `.dashboard-content` and left the topbar un-dimmed — it tied the
          topbar on z-index, and the content wrapper's fade-in animates a
          `transform`, which makes an ancestor stacking context / containing
          block that a `fixed` child cannot escape. Portalling sidesteps both. */}
      {mounted && selectedDay && createPortal(
        <>
          {/* Drawer overlay backdrop */}
          <div
            className="fixed inset-0 bg-black/30 backdrop-blur-[1px] z-[60] transition-opacity"
            onClick={() => setSelectedDay(null)}
          />
          {/* Panel */}
          <div className="fixed top-0 right-0 h-full w-full md:w-[420px] bg-white border-l shadow-2xl z-[70] flex flex-col animate-slide-in overflow-hidden bg-card text-slate-800">
            {/* Header */}
            <div className="px-5 py-4 border-b flex items-center justify-between bg-slate-50">
              <div>
                <h3 className="font-bold text-sm text-slate-800 uppercase tracking-wider">
                  Agenda for Day
                </h3>
                <span className="text-xs font-semibold text-brand-cyan-deep">
                  {parseLocalISODate(selectedDay).toLocaleDateString("en-IN", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </span>
              </div>
              <button
                onClick={() => setSelectedDay(null)}
                className="p-1.5 rounded-full hover:bg-slate-200 text-slate-500 hover:text-slate-700 transition-colors focus:outline-none"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin">
              {drawerItems.length === 0 ? (
                <div className="text-center p-12 text-sm text-muted-foreground italic border border-dashed rounded-lg bg-slate-50">
                  No active events scheduled for this day.
                </div>
              ) : (
                drawerItems.map((it, idx) => {
                  const meta = KIND_META[it.kind];
                  const Icon = meta.icon;
                  return (
                    <div
                      key={idx}
                      className={`flex flex-col border rounded-lg p-3 hover:shadow-sm transition-shadow ${meta.color}`}
                    >
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <Icon className="size-3.5 flex-shrink-0" />
                        <span className="text-[10px] uppercase font-extrabold tracking-wider opacity-75">
                          {meta.label}
                        </span>
                      </div>
                      <div className="font-semibold text-sm leading-snug flex items-center gap-2">
                        {it.subjectId && (
                          <Avatar src={it.avatarUrl ? `/api/${it.subjectType === "lead" ? "leads" : "investors"}/${it.subjectId}/avatar` : null} name={it.personName ?? it.title} size={24} />
                        )}
                        <span>{it.title}</span>
                      </div>
                      {it.meta && (
                        <div className="text-xs opacity-80 mt-1 font-mono font-medium leading-relaxed">
                          {it.meta}
                        </div>
                      )}
                      <div className="mt-3 flex justify-end">
                        <Link
                          href={it.href}
                          onClick={() => setSelectedDay(null)}
                          className="text-xs font-bold inline-flex items-center gap-1 hover:underline text-brand-cyan-deep"
                        >
                          View Details <ExternalLink className="size-3" />
                        </Link>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            
            {/* Footer */}
            <div className="px-4 py-3 border-t bg-slate-50 flex justify-end">
              <button onClick={() => setSelectedDay(null)} className="btn-secondary text-xs px-4 py-1.5">
                Close
              </button>
            </div>
          </div>

          <style jsx global>{`
            @keyframes slide-in {
              from {
                transform: translateX(100%);
              }
              to {
                transform: translateX(0);
              }
            }
            .animate-slide-in {
              animation: slide-in 0.23s cubic-bezier(0.16, 1, 0.3, 1) forwards;
            }
          `}</style>
        </>,
        document.body
      )}
    </div>
  );
}
