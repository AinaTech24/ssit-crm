"use client";

/**
 * Header birthday widget (cake icon) — adopted from the Sanchay birthday
 * popup. Shows client birthdays bucketed Today / Tomorrow with a count badge,
 * and a "View all" link that opens the whole current month on the client list.
 *
 * There used to be a third "Past" tab (birthdays in the last 30 days). It was
 * the biggest number in the widget and the least actionable — a wish you
 * already missed is not work you can do — so it is gone. The API still returns
 * the bucket; nothing here reads it.
 *
 * Data: GET /api/birthdays (role-scoped — firm-wide for owners, own-book for
 * RMs). Polls every 5 min and refreshes when opened.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Cake, ArrowRight } from "lucide-react";

type Item = { id: string; name: string; dob: string; turning: number | null };
type Bucket = "today" | "tomorrow";

export function BirthdayBell() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Bucket>("today");
  const [data, setData] = useState<{ today: Item[]; tomorrow: Item[] }>({
    today: [],
    tomorrow: [],
  });
  const ref = useRef<HTMLDivElement>(null);

  async function load() {
    try {
      const res = await fetch("/api/birthdays");
      if (!res.ok) return;
      const j = await res.json();
      setData({ today: j.today ?? [], tomorrow: j.tomorrow ?? [] });
    } catch {}
  }

  useEffect(() => {
    load();
    const i = setInterval(load, 15 * 60_000);
    return () => clearInterval(i);
  }, []);

  // Default to whichever bucket has people, preferring Today.
  useEffect(() => {
    if (data.today.length) setTab("today");
    else if (data.tomorrow.length) setTab("tomorrow");
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
          <div className="grid grid-cols-2 border-b">
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
                No birthdays {tab === "today" ? "today" : "tomorrow"}.
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
                          : it.turning ? `Turns ${it.turning} tomorrow` : "Birthday tomorrow"}
                      </div>
                    </div>
                    <ArrowRight className="size-3.5 text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {/* View all opens the WHOLE month, not just the day being shown —
              the popup already lists today and tomorrow in full, so repeating
              them on the client list adds nothing. The month is the thing you
              can actually plan around. */}
          <Link
            href="/dashboard/investors?birthday_month=1"
            onClick={() => setOpen(false)}
            className="block text-center px-4 py-2.5 text-xs font-medium text-brand-cyan-deep hover:underline border-t bg-card"
          >
            View all {monthName()} birthdays →
          </Link>
        </div>
      )}
    </div>
  );
}

/** "September" — names the month the "View all" link opens. */
function monthName(): string {
  return new Date().toLocaleDateString("en-IN", { month: "long" });
}
