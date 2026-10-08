"use client";

/**
 * Custom date picker — branded calendar popup replacing the native
 * <input type="date">. Value is an ISO `yyyy-mm-dd` string (same as the native
 * input, so it's a drop-in for our forms); the trigger displays `dd-mm-yyyy`.
 *
 *   <DatePicker value={iso} onChange={setIso} />
 *
 * The calendar is rendered in a portal with FIXED positioning so it can never
 * be clipped by an ancestor with `overflow-hidden` / `transform` (e.g. the
 * Owner Cockpit gradient banner, scroll containers, table cells). It flips
 * above the trigger when there isn't room below.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Position the calendar BEFORE paint so it doesn't flash at the wrong spot then
// jump (the open stutter). Falls back to useEffect during SSR.
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;
import { Calendar as CalIcon, ChevronLeft, ChevronRight } from "lucide-react";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DOW = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

const POPUP_W = 272; // 17rem
const POPUP_H = 336; // header + 6 weeks + footer (estimate, for flip math)

function toISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fromISO(s?: string): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : d;
}
export function formatDisplayDate(s?: string) {
  const d = fromISO(s);
  if (!d) return "";
  return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
}

export function DatePicker({
  value,
  onChange,
  placeholder = "dd-mm-yyyy",
  disabled,
  className = "",
  min,
  max,
  ariaLabel,
  size = "md",
  clearable = true,
}: {
  value: string;
  onChange: (iso: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  min?: string;
  max?: string;
  ariaLabel?: string;
  size?: "sm" | "md";
  clearable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const selected = useMemo(() => fromISO(value), [value]);
  const [view, setView] = useState<Date>(() => fromISO(value) ?? new Date());

  // Compute fixed (viewport-relative) coordinates from the trigger rect, with
  // edge-aware left alignment + flip-up when there's no room below.
  function reposition() {
    const el = ref.current;
    if (!el || typeof window === "undefined") return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = vw - rect.left < POPUP_W + 8 ? Math.max(8, rect.right - POPUP_W) : rect.left;
    const spaceBelow = vh - rect.bottom;
    const flipUp = spaceBelow < POPUP_H + 8 && rect.top > spaceBelow;
    const top = flipUp ? Math.max(8, rect.top - POPUP_H - 4) : rect.bottom + 4;
    setCoords({ left, top });
  }

  useIsoLayoutEffect(() => {
    if (!open) return;
    setView(fromISO(value) ?? new Date());
    reposition();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (ref.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    // Fixed coordinates go stale on scroll/resize — recompute so the calendar
    // tracks the trigger (any scrollable ancestor bubbles a scroll event here).
    function onReflow() {
      reposition();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onReflow);
    window.addEventListener("scroll", onReflow, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const y = view.getFullYear();
  const m = view.getMonth();
  const firstDow = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const minD = fromISO(min);
  const maxD = fromISO(max);
  const todayISO = toISO(new Date());

  // Jump straight to any month / year instead of paging month by month — a date
  // of birth is decades back. Bounded by min/max when given, otherwise a wide
  // default; always includes the year currently in view so it can never be
  // missing from its own dropdown.
  const nowY = new Date().getFullYear();
  const yFrom = Math.min(minD ? minD.getFullYear() : nowY - 100, y);
  const yTo = Math.max(maxD ? maxD.getFullYear() : nowY + 30, y);
  const years: number[] = [];
  for (let yy = yTo; yy >= yFrom; yy--) years.push(yy);

  const grid: Array<{ date: Date; inMonth: boolean }> = [];
  const prevDays = new Date(y, m, 0).getDate();
  for (let i = firstDow - 1; i >= 0; i--) grid.push({ date: new Date(y, m - 1, prevDays - i), inMonth: false });
  for (let d = 1; d <= daysInMonth; d++) grid.push({ date: new Date(y, m, d), inMonth: true });
  let nextDay = 1;
  while (grid.length < 42) grid.push({ date: new Date(y, m + 1, nextDay++), inMonth: false });

  function isDisabled(d: Date) {
    const iso = toISO(d);
    if (minD && iso < toISO(minD)) return true;
    if (maxD && iso > toISO(maxD)) return true;
    return false;
  }

  // `md` mirrors `.input-base` exactly (px-3 py-2 text-sm → 38px tall) so the
  // date trigger lines up flush with native <input>s sitting beside it.
  const sizes = size === "sm" ? "h-8 text-xs px-2.5" : "text-sm px-3 py-2";

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((s) => !s)}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`w-full inline-flex items-center justify-between gap-1.5 rounded-lg border bg-card shadow-sm font-medium whitespace-nowrap transition ${sizes}
          ${open ? "border-brand-cyan/60 ring-2 ring-brand-cyan/15" : "border-border hover:bg-secondary/60"}
          disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none`}
      >
        <span className={`whitespace-nowrap ${selected ? "text-foreground" : "text-muted-foreground"}`}>
          {selected ? formatDisplayDate(value) : placeholder}
        </span>
        <CalIcon className="size-3.5 shrink-0 text-muted-foreground" />
      </button>

      {open && coords && typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popRef}
            data-floating-popup
            style={{ position: "fixed", left: coords.left, top: coords.top, width: POPUP_W, zIndex: 80 }}
            className="card-elevated bg-card p-3 animate-scale-in"
          >
            <div className="flex items-center justify-between mb-2">
              <button type="button" onClick={() => setView(new Date(y, m - 1, 1))} className="size-7 grid place-items-center rounded-md hover:bg-secondary" aria-label="Previous month">
                <ChevronLeft className="size-4" />
              </button>
              <div className="flex items-center gap-1">
                <select
                  value={m}
                  onChange={(e) => setView(new Date(y, Number(e.target.value), 1))}
                  className="text-sm font-semibold bg-transparent rounded-md px-1 py-0.5 hover:bg-secondary cursor-pointer focus:outline-none"
                  aria-label="Month"
                >
                  {MONTHS.map((name, idx) => (
                    <option key={name} value={idx}>{name}</option>
                  ))}
                </select>
                <select
                  value={y}
                  onChange={(e) => setView(new Date(Number(e.target.value), m, 1))}
                  className="text-sm font-semibold bg-transparent rounded-md px-1 py-0.5 hover:bg-secondary cursor-pointer focus:outline-none"
                  aria-label="Year"
                >
                  {years.map((yy) => (
                    <option key={yy} value={yy}>{yy}</option>
                  ))}
                </select>
              </div>
              <button type="button" onClick={() => setView(new Date(y, m + 1, 1))} className="size-7 grid place-items-center rounded-md hover:bg-secondary" aria-label="Next month">
                <ChevronRight className="size-4" />
              </button>
            </div>
            <div className="grid grid-cols-7 gap-0.5 text-center">
              {DOW.map((d) => (
                <div key={d} className="text-[10px] font-semibold text-muted-foreground py-1">{d}</div>
              ))}
              {grid.map((c, i) => {
                const iso = toISO(c.date);
                const isSel = value === iso;
                const isToday = todayISO === iso;
                const dis = isDisabled(c.date);
                return (
                  <button
                    key={i}
                    type="button"
                    disabled={dis}
                    onClick={() => { onChange(iso); setOpen(false); }}
                    className={`h-8 rounded-md text-xs transition
                      ${c.inMonth ? "text-foreground" : "text-muted-foreground/40"}
                      ${isSel ? "bg-brand-cyan text-white font-semibold hover:bg-brand-cyan" : "hover:bg-secondary"}
                      ${isToday && !isSel ? "ring-1 ring-brand-cyan/50" : ""}
                      disabled:opacity-30 disabled:cursor-not-allowed`}
                  >
                    {c.date.getDate()}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-border">
              {clearable ? (
                <button type="button" onClick={() => { onChange(""); setOpen(false); }} className="text-xs text-muted-foreground hover:text-rose-600">
                  Clear
                </button>
              ) : <span />}
              <button type="button" onClick={() => { onChange(todayISO); setOpen(false); }} className="text-xs text-brand-cyan font-medium hover:underline">
                Today
              </button>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
