"use client";

/**
 * Custom date-range picker — a quick-preset dropdown (Today, Last 7 days, This
 * FY, …) plus two calendar pickers for an explicit from→to range. Values are
 * ISO `yyyy-mm-dd` strings. Built from <Select> + <DatePicker>.
 *
 *   <DateRangePicker from={f} to={t} onChange={(f,t)=>…} />
 */

import { X } from "lucide-react";
import { Select } from "./Select";
import { DatePicker } from "./DatePicker";

/** Quick presets → compute [from, to] as yyyy-mm-dd. India FY = Apr–Mar. */
function rangePreset(key: string): [string, string] {
  const now = new Date();
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const y = now.getFullYear();
  const m = now.getMonth();
  const fyStartYear = m >= 3 ? y : y - 1;
  const qStartMonth = m >= 3 && m <= 5 ? 3 : m >= 6 && m <= 8 ? 6 : m >= 9 && m <= 11 ? 9 : 0;
  switch (key) {
    case "today": return [iso(now), iso(now)];
    case "yesterday": { const d = new Date(now); d.setDate(d.getDate() - 1); return [iso(d), iso(d)]; }
    case "7d": { const d = new Date(now); d.setDate(d.getDate() - 6); return [iso(d), iso(now)]; }
    case "30d": { const d = new Date(now); d.setDate(d.getDate() - 29); return [iso(d), iso(now)]; }
    case "month": return [iso(new Date(y, m, 1)), iso(now)];
    case "lastmonth": { const s = new Date(y, m - 1, 1); const e = new Date(y, m, 0); return [iso(s), iso(e)]; }
    case "quarter": return [iso(new Date(y, qStartMonth, 1)), iso(now)];
    case "fy": return [iso(new Date(fyStartYear, 3, 1)), iso(now)];
    default: return ["", ""];
  }
}

const PRESETS: Array<{ value: string; label: string }> = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "month", label: "This month" },
  { value: "lastmonth", label: "Last month" },
  { value: "quarter", label: "This quarter" },
  { value: "fy", label: "This FY" },
];

export function DateRangePicker({
  from,
  to,
  onChange,
  label,
  size = "sm",
  className = "",
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  label?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const active = !!(from || to);
  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2 ${size === "sm" ? "h-8" : "h-9"} ${
        active ? "border-brand-cyan/40 bg-brand-cyan-light/40" : "border-border bg-card"
      } ${className}`}
    >
      {label && <span className="text-xs text-muted-foreground whitespace-nowrap">{label}</span>}
      <Select
        size={size}
        value=""
        placeholder="Range…"
        options={PRESETS}
        onChange={(k) => { const [f, t] = rangePreset(k); onChange(f, t); }}
        ariaLabel="Quick range"
        className="w-[6.5rem]"
      />
      <span className="text-muted-foreground/50">|</span>
      <DatePicker
        size={size}
        value={from}
        onChange={(f) => onChange(f, to)}
        max={to || undefined}
        ariaLabel="From date"
        className="w-[7.5rem]"
      />
      <span className="text-muted-foreground">→</span>
      <DatePicker
        size={size}
        value={to}
        onChange={(t) => onChange(from, t)}
        min={from || undefined}
        ariaLabel="To date"
        className="w-[7.5rem]"
      />
      {active && (
        <button
          type="button"
          onClick={() => onChange("", "")}
          className="text-muted-foreground hover:text-rose-600 ml-0.5"
          aria-label="Clear date range"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}
