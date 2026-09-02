"use client";

/**
 * Header birthday widget (cake icon) — adopted from the Sanchay birthday
 * popup. Shows client birthdays bucketed Past / Today / Tomorrow with a
 * count badge, and a "View all" link to the filtered client list.
 *
 * Data: GET /api/birthdays (role-scoped — firm-wide for owners, own-book for
 * RMs). Polls every 5 min and refreshes when opened.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Cake, ArrowRight } from "lucide-react";

type Item = { id: string; name: string; dob: string; turning: number | null };
type Bucket = "past" | "today" | "tomorrow";

export function BirthdayBell() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Bucket>("today");
  const [data, setData] = useState<{ past: Item[]; today: Item[]; tomorrow: Item[] }>({
    past: [],
    today: [],
    tomorrow: [],
  });
  const ref = useRef<HTMLDivElement>(null);

  async function load() {
    try {
      const res = await fetch("/api/birthdays");
      if (!res.ok) return;
      const j = await res.json();
      setData({ past: j.past ?? [], today: j.today ?? [], tomorrow: j.tomorrow ?? [] });
    } catch {}
  }

  useEffect(() => {
    load();
    const i = setInterval(load, 15 * 60_000);
    return () => clearInterval(i);
  }, []);

  // Default to whichever bucket has people, preferring Today → Tomorrow → Past.
  useEffect(() => {
    if (data.today.length) setTab("today");
    else if (data.tomorrow.length) setTab("tomorrow");
    else if (data.past.length) setTab("past");
  }, [data]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (open && ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const todayCount = data.today.length;
  const items = data[tab];

  const TABS: { key: Bucket; label: string }[] = [
    { key: "past", label: "Past" },
    { key: "today", label: "Today" },
    { key: "tomorrow", label: "Tomorrow" },
  ];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => { setOpen((o) => !o); if (!open) load(); }}
        className="relative size-9 rounded-full bg-secondary/70 hover:bg-secondary text-muted-foreground hover:text-foreground grid place-items-center transition-colors"
        aria-label="Birthdays"
        title="Client birthdays — today, tomorrow & recent"
      >
        <Cake className="size-4" />
        {todayCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 size-4 grid place-items-center rounded-full bg-rose-500 text-white text-[10px] font-semibold">
            {todayCount > 9 ? "9+" : todayCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 border bg-card rounded-lg shadow-lg w-80 z-40 overflow-hidden">
          {/* Tabs */}
          <div className="grid grid-cols-3 border-b">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`py-2.5 text-xs font-semibold uppercase tracking-wide transition-colors ${
                  tab === t.key
                    ? "bg-brand-cyan-deep text-white"
                    : "bg-secondary/40 text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
                {data[t.key].length > 0 && (
                  <span className={`ml-1 ${tab === t.key ? "text-white/80" : "text-muted-foreground"}`}>
                    ({data[t.key].length})
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* List */}
          {items.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <Cake className="size-9 text-muted-foreground/40 mx-auto mb-2" />
              <div className="text-sm text-muted-foreground">
                No birthdays {tab === "today" ? "today" : tab === "tomorrow" ? "tomorrow" : "in the last 30 days"}.
              </div>
            </div>
          ) : (
            <ul className="divide-y max-h-[50vh] overflow-y-auto">
              {items.map((it) => (
                <li key={it.id}>
                  <Link
                    href={`/dashboard/investors/${it.id}`}
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-accent transition-colors"
                  >
                    <span className="size-8 rounded-full bg-violet-50 text-violet-600 grid place-items-center flex-shrink-0">
                      <Cake className="size-4" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{it.name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {tab === "today"
                          ? it.turning ? `Turns ${it.turning} today 🎉` : "Birthday today 🎉"
                          : tab === "tomorrow"
                          ? it.turning ? `Turns ${it.turning} tomorrow` : "Birthday tomorrow"
                          : `Birthday ${fmtDM(it.dob)}`}
                      </div>
                    </div>
                    <ArrowRight className="size-3.5 text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {/* View all — respects the selected tab (today / tomorrow / past). */}
          {(() => {
            const va =
              tab === "tomorrow"
                ? { href: "/dashboard/investors?birthday_tomorrow=1", label: "View all tomorrow's birthdays" }
                : tab === "past"
                ? { href: "/dashboard/investors?birthday_past=1", label: "View all recent birthdays" }
                : { href: "/dashboard/investors?birthday_today=1", label: "View all today's birthdays" };
            return (
              <Link
                href={va.href}
                onClick={() => setOpen(false)}
                className="block text-center px-4 py-2.5 text-xs font-medium text-brand-cyan-deep hover:underline border-t bg-card"
              >
                {va.label} →
              </Link>
            );
          })()}
        </div>
      )}
    </div>
  );
}

function fmtDM(dob: string): string {
  const d = new Date(dob);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}
