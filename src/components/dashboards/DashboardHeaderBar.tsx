"use client";

/**
 * Dashboard hero controls — the right-hand cluster on the Owner cockpit banner:
 *
 *   [ View ▾ ]   [ + Create ]   [ Period ▾ ]
 *
 * - View     — switch between Dashboards / Team Dashboards / Team Scorecard.
 * - Create   — spin up a new "My Dashboard" board (themed name modal → POST → edit).
 * - Period   — a single dropdown replacing the old row of chips. Holds the
 *              named windows (Month/Quarter/FY to date, Last month) plus the
 *              richer pickers: Monthly, Quarterly, Since, and Custom from–to.
 *
 * The banner is a `.card-elevated` with `overflow-hidden` + `backdrop-blur`,
 * which clips absolutely/fixed-positioned children AND establishes a containing
 * block. So the dropdown panels are rendered through a PORTAL to document.body,
 * fixed-positioned under their trigger — otherwise they'd be cut off by the hero.
 *
 * Purely a URL-param writer: it sets ?period / ?pstart / ?pfrom / ?pto and the
 * server cockpit resolves the range.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { CalendarDays, ChevronDown, Plus, LayoutGrid, Loader2, Check } from "lucide-react";
import { DatePicker } from "@/components/ui/DatePicker";
import { SelectField } from "@/components/ui/SelectField";
import type { Period } from "@/lib/dashboard/period";

const VIEWS: { href: string; label: string }[] = [
  { href: "/dashboard/boards", label: "My Dashboards" },
  { href: "/dashboard/team", label: "Team Dashboards" },
  { href: "/dashboard/team/scorecard", label: "Team Scorecard" },
];

type SubMode = null | "monthly" | "quarterly" | "since" | "range";
type Anchor = { top: number; right: number };

/** Last day of a "YYYY-MM" month, as YYYY-MM-DD. */
function monthRange(ym: string): { from: string; to: string } {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, "0")}` };
}

/** India-FY quarter options for the current + previous financial year. */
function quarterOptions(now: Date): { key: string; label: string; from: string; to: string }[] {
  const y = now.getFullYear();
  const fyStart = now.getMonth() >= 3 ? y : y - 1; // Apr–Mar
  const out: { key: string; label: string; from: string; to: string }[] = [];
  for (const fy of [fyStart, fyStart - 1]) {
    const tag = `FY${String(fy).slice(-2)}-${String(fy + 1).slice(-2)}`;
    const qs = [
      { q: "Q1", from: `${fy}-04-01`, to: `${fy}-06-30` },
      { q: "Q2", from: `${fy}-07-01`, to: `${fy}-09-30` },
      { q: "Q3", from: `${fy}-10-01`, to: `${fy}-12-31` },
      { q: "Q4", from: `${fy + 1}-01-01`, to: `${fy + 1}-03-31` },
    ];
    for (const it of qs) {
      if (new Date(it.from + "T00:00:00") > now) continue; // skip future quarters
      out.push({ key: `${fy}-${it.q}`, label: `${it.q} ${tag}`, from: it.from, to: it.to });
    }
  }
  return out;
}

/** Recent months (this month back 11) as { value: "YYYY-MM", label }. */
function monthOptions(now: Date): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    out.push({ value, label: d.toLocaleDateString("en-IN", { month: "long", year: "numeric" }) });
  }
  return out;
}

/** Fixed-position anchor (top/right) just below a trigger element. */
function anchorFor(el: HTMLElement | null): Anchor | null {
  if (!el || typeof window === "undefined") return null;
  const r = el.getBoundingClientRect();
  return { top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) };
}

export function DashboardHeaderBar({
  period,
  currentLabel,
  variant = "light",
}: {
  period: Period;
  currentLabel: string;
  variant?: "dark" | "light";
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const [viewOpen, setViewOpen] = useState(false);
  const [periodOpen, setPeriodOpen] = useState(false);
  const [viewAnchor, setViewAnchor] = useState<Anchor | null>(null);
  const [periodAnchor, setPeriodAnchor] = useState<Anchor | null>(null);
  const [sub, setSub] = useState<SubMode>(null);
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("My Dashboard");
  const [creating, setCreating] = useState(false);

  const viewBtnRef = useRef<HTMLButtonElement>(null);
  const periodBtnRef = useRef<HTMLButtonElement>(null);
  const viewMenuRef = useRef<HTMLDivElement>(null);
  const periodMenuRef = useRef<HTMLDivElement>(null);
  const now = new Date();

  const closeAll = () => { setViewOpen(false); setPeriodOpen(false); setSub(null); };

  // Close on outside click / Esc / page-scroll / resize. Clicks and inner-scrolls
  // inside the menus OR inside a portaled Select/DatePicker popup must NOT close
  // it — those popups live in their own body portal, so without this guard
  // picking a month/date would instantly dismiss the menu (the stutter).
  useEffect(() => {
    if (!viewOpen && !periodOpen) return;
    const insideOurUi = (t: HTMLElement | null) =>
      !!t && (
        !!t.closest?.("[data-floating-popup]") ||
        !!viewBtnRef.current?.contains(t) || !!viewMenuRef.current?.contains(t) ||
        !!periodBtnRef.current?.contains(t) || !!periodMenuRef.current?.contains(t)
      );
    function onDoc(e: MouseEvent) { if (!insideOurUi(e.target as HTMLElement)) closeAll(); }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") closeAll(); }
    function onScroll(e: Event) { if (!insideOurUi(e.target as HTMLElement)) closeAll(); }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", closeAll);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", closeAll);
    };
  }, [viewOpen, periodOpen]);

  function toggleView() {
    if (viewOpen) { setViewOpen(false); return; }
    setPeriodOpen(false);
    setViewAnchor(anchorFor(viewBtnRef.current));
    setViewOpen(true);
  }
  function togglePeriod() {
    if (periodOpen) { setPeriodOpen(false); setSub(null); return; }
    setViewOpen(false);
    setPeriodAnchor(anchorFor(periodBtnRef.current));
    setPeriodOpen(true);
  }

  function apply(next: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams.toString());
    ["period", "pstart", "pfrom", "pto"].forEach((k) => params.delete(k));
    for (const [k, v] of Object.entries(next)) if (v) params.set(k, v);
    const qs = params.toString();
    closeAll();
    startTransition(() => router.push(`${pathname}${qs ? `?${qs}` : ""}`));
  }

  async function submitCreate() {
    if (!createName.trim() || creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/dashboards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: createName.trim() }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j?.id) router.push(`/dashboard/boards/${j.id}/edit`);
      else setCreating(false);
    } catch {
      setCreating(false);
    }
  }

  const btn = variant === "dark"
    ? "inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/10 backdrop-blur-sm px-3 py-1.5 text-xs font-medium text-white hover:bg-white/20 transition-colors whitespace-nowrap"
    : "inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent shadow-sm transition-colors whitespace-nowrap";
  const panel = "z-50 min-w-[13rem] max-h-[70vh] overflow-y-auto rounded-lg border border-border bg-popover p-1.5 shadow-2xl text-foreground";
  const item = "w-full text-left rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors flex items-center justify-between gap-2";

  const simple: { key: Period; label: string }[] = [
    { key: "mtd", label: "Month to date" },
    { key: "qtd", label: "Quarter to date" },
    { key: "fytd", label: "FY to date" },
    { key: "lm", label: "Last month" },
  ];

  const canPortal = typeof document !== "undefined";

  return (
    <div className={`flex items-center gap-2 ${pending ? "opacity-60 pointer-events-none" : ""}`}>
      {/* ---- View switcher ---- */}
      <button ref={viewBtnRef} type="button" className={btn} onClick={toggleView} aria-haspopup="menu" aria-expanded={viewOpen}>
        <LayoutGrid className="size-3.5" /> View <ChevronDown className="size-3.5" />
      </button>

      {/* ---- Create board ---- */}
      <button type="button" className={btn} onClick={() => { setCreateName("My Dashboard"); setCreateOpen(true); }}>
        <Plus className="size-3.5" /> Create
      </button>

      {/* ---- Period filter trigger ---- */}
      <button ref={periodBtnRef} type="button" className={btn} onClick={togglePeriod} aria-haspopup="menu" aria-expanded={periodOpen}>
        <CalendarDays className="size-3.5" /> {currentLabel} <ChevronDown className="size-3.5" />
      </button>

      {/* ---- View menu (portaled, fixed under the trigger) ---- */}
      {canPortal && viewOpen && viewAnchor && createPortal(
        <div ref={viewMenuRef} className={`fixed ${panel}`} style={{ top: viewAnchor.top, right: viewAnchor.right }} role="menu">
          {VIEWS.map((v) => {
            const active = v.href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(v.href);
            return (
              <button key={v.href} className={item} onClick={() => { closeAll(); router.push(v.href); }}>
                <span>{v.label}</span>
                {active && <Check className="size-3.5 text-brand-cyan-deep" />}
              </button>
            );
          })}
        </div>,
        document.body
      )}

      {/* ---- Period menu (portaled, fixed under the trigger) ---- */}
      {canPortal && periodOpen && periodAnchor && createPortal(
        <div ref={periodMenuRef} className={`fixed ${panel} min-w-[15rem]`} style={{ top: periodAnchor.top, right: periodAnchor.right }} role="menu">
          {simple.map((s) => (
            <button key={s.key} className={item} onClick={() => apply(s.key === "mtd" ? {} : { period: s.key })}>
              <span>{s.label}</span>
              {period === s.key && <Check className="size-3.5 text-brand-cyan-deep" />}
            </button>
          ))}

          <div className="my-1 border-t border-border/60" />

          {/* Monthly — pick a specific calendar month */}
          <button className={item} onClick={() => setSub(sub === "monthly" ? null : "monthly")}>
            <span>Monthly</span><ChevronDown className={`size-3.5 transition-transform ${sub === "monthly" ? "rotate-180" : ""}`} />
          </button>
          {sub === "monthly" && (
            <div className="px-2 py-1.5">
              <SelectField value="" placeholder="Select a month…" size="sm" className="w-full" aria-label="Select a month"
                onChange={(e) => { if (e.target.value) { const { from, to } = monthRange(e.target.value); apply({ period: "custom", pfrom: from, pto: to }); } }}>
                {monthOptions(now).map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </SelectField>
            </div>
          )}

          {/* Quarterly — pick a FY quarter */}
          <button className={item} onClick={() => setSub(sub === "quarterly" ? null : "quarterly")}>
            <span>Quarterly</span><ChevronDown className={`size-3.5 transition-transform ${sub === "quarterly" ? "rotate-180" : ""}`} />
          </button>
          {sub === "quarterly" && (
            <div className="px-2 py-1.5">
              <SelectField value="" placeholder="Select a quarter…" size="sm" className="w-full" aria-label="Select a quarter"
                onChange={(e) => { const opt = quarterOptions(now).find((q) => q.key === e.target.value); if (opt) apply({ period: "custom", pfrom: opt.from, pto: opt.to }); }}>
                {quarterOptions(now).map((q) => <option key={q.key} value={q.key}>{q.label}</option>)}
              </SelectField>
            </div>
          )}

          {/* Since — everything from a start date to now */}
          <button className={item} onClick={() => setSub(sub === "since" ? null : "since")}>
            <span>Since a date</span><ChevronDown className={`size-3.5 transition-transform ${sub === "since" ? "rotate-180" : ""}`} />
          </button>
          {sub === "since" && (
            <div className="px-2 py-1.5">
              <DatePicker value="" onChange={(iso) => { if (iso) apply({ period: "custom", pstart: iso }); }} size="sm" className="w-full" ariaLabel="Since date" />
            </div>
          )}

          {/* Custom range — explicit from → to */}
          <button className={item} onClick={() => setSub(sub === "range" ? null : "range")}>
            <span>Custom range</span><ChevronDown className={`size-3.5 transition-transform ${sub === "range" ? "rotate-180" : ""}`} />
          </button>
          {sub === "range" && (
            <div className="px-2 py-1.5 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground w-8">From</span>
                <DatePicker value={rangeFrom} onChange={setRangeFrom} size="sm" className="flex-1" ariaLabel="Range from" />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground w-8">To</span>
                <DatePicker value={rangeTo} onChange={setRangeTo} size="sm" className="flex-1" ariaLabel="Range to" />
              </div>
              <button className="w-full btn-primary text-xs justify-center disabled:opacity-50" disabled={!rangeFrom || !rangeTo}
                onClick={() => apply({ period: "custom", pfrom: rangeFrom, pto: rangeTo })}>
                Apply range
              </button>
            </div>
          )}
        </div>,
        document.body
      )}

      {/* ---- Create-dashboard modal (themed, portaled) ---- */}
      {canPortal && createOpen && createPortal(
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/40 backdrop-blur-sm p-4" onMouseDown={() => !creating && setCreateOpen(false)}>
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-foreground">New dashboard</h3>
            <p className="text-xs text-muted-foreground mt-1">Give your dashboard a name — you can add widgets next.</p>
            <input
              autoFocus
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submitCreate(); if (e.key === "Escape") setCreateOpen(false); }}
              placeholder="Dashboard name"
              className="mt-3 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-brand-cyan/40"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="btn-secondary text-sm" onClick={() => setCreateOpen(false)} disabled={creating}>Cancel</button>
              <button type="button" className="btn-primary text-sm inline-flex items-center gap-1.5" onClick={submitCreate} disabled={!createName.trim() || creating}>
                {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Create
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
