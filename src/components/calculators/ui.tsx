"use client";

/**
 * Shared presentational primitives for the Calculators suite — inputs, toggles,
 * result tables, insight callouts and the INR formatter. Kept in one place so
 * every calculator looks and behaves identically. Pure presentation (no domain
 * math, no data fetching).
 */

import type React from "react";

export function inr(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Math.round(n));
}

/** Clamp a raw input string to a non-negative finite number (0 on garbage). */
export function clampNum(raw: string): number {
  const n = raw === "" ? 0 : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function fmtPct(n: number): string {
  return `${Number.isInteger(n) ? n : n.toFixed(1)}%`;
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium block mb-1">{label}</span>
      {children}
    </label>
  );
}

export function NumberField({
  label, value, setValue, step = 1000,
}: { label: string; value: number; setValue: (v: number) => void; step?: number }) {
  return (
    <Field label={label}>
      <input
        type="number"
        value={value}
        step={step}
        min={0}
        onChange={(e) => setValue(clampNum(e.target.value))}
        className="input-base text-sm w-full"
      />
    </Field>
  );
}

export function TextField({
  label, value, setValue, placeholder,
}: { label: string; value: string; setValue: (v: string) => void; placeholder?: string }) {
  return (
    <Field label={label}>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className="input-base text-sm w-full"
      />
    </Field>
  );
}

/** Segmented single-choice control (radio replacement). */
export function Segmented<T extends string>({
  value, onChange, options, label,
}: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string }>; label?: string }) {
  return (
    <div>
      {label && (
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium block mb-1">{label}</span>
      )}
      {/* data-calc-seg + data-active let the scenario save/restore snapshot the
          selected mode generically (see ScenarioControls). */}
      <div
        data-calc-seg={label ?? ""}
        data-pdf-input=""
        data-pdf-input-label={label ?? ""}
        data-pdf-input-value={options.find((o) => o.value === value)?.label ?? String(value)}
        className="inline-flex flex-wrap rounded-lg border border-border bg-secondary/30 p-0.5 gap-0.5"
      >
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            data-active={value === o.value ? "1" : undefined}
            onClick={() => onChange(o.value)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              value === o.value ? "bg-primary text-white shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SmallNum({
  label, value, onChange,
}: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="text-[10px] text-muted-foreground block mb-0.5">{label}</span>
      <input
        type="number"
        value={value}
        step={1}
        min={0}
        onChange={(e) => onChange(clampNum(e.target.value))}
        className="input-base text-sm w-full"
      />
    </label>
  );
}

export function Toggle({
  checked, onChange, label,
}: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 rounded border-border accent-primary"
      />
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">{label}</span>
    </label>
  );
}

export function Section({ n, title, children }: { n: number | string; title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2 break-inside-avoid">
      <h3 data-pdf="section" data-pdf-title={title} className="text-sm font-semibold flex items-center gap-2">
        <span className="inline-grid place-items-center size-5 rounded-md bg-primary/10 text-primary text-[11px] font-bold">{n}</span>
        {title}
      </h3>
      {children}
    </div>
  );
}

export function Stat({ label, value, tone }: { label: string; value: string; tone?: "cyan" | "emerald" | "amber" | "rose" }) {
  const t =
    tone === "cyan" ? "border-primary/30 bg-primary/10"
      : tone === "emerald" ? "border-emerald-200 bg-emerald-50/60"
        : tone === "amber" ? "border-amber-200 bg-amber-50/60"
          : tone === "rose" ? "border-rose-200 bg-rose-50/60"
            : "";
  return (
    <div data-pdf="stat" data-pdf-label={label} data-pdf-value={value} className={`border rounded-md p-3 ${t}`}>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">{label}</div>
      <div className="text-lg font-semibold mt-0.5">{value}</div>
    </div>
  );
}

export function Table({
  head, rows, highlightLastRow, highlightCol,
}: {
  head: string[];
  rows: (string | number)[][];
  highlightLastRow?: boolean;
  /** 0-based column index to emphasise (e.g. the winning strategy). */
  highlightCol?: number;
}) {
  return (
    <div className="overflow-x-auto">
      <table data-pdf="table" className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left">
            {head.map((h, i) => (
              <th
                key={i}
                className={`py-1.5 px-3 text-[11px] uppercase tracking-wide font-semibold border-b border-border ${i > 0 ? "text-right" : ""} ${highlightCol === i ? "text-emerald-700" : "text-muted-foreground"}`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => {
            const isLast = ri === rows.length - 1;
            return (
              <tr key={ri} className={highlightLastRow && isLast ? "bg-emerald-50/50 font-medium" : ""}>
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    className={`py-1.5 px-3 border-b border-border/50 ${ci > 0 ? "text-right tabular-nums" : "font-medium"} ${highlightCol === ci ? "text-emerald-700 font-semibold" : ""}`}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function Insight({ children, tone = "emerald" }: { children: React.ReactNode; tone?: "emerald" | "amber" | "rose" | "cyan" }) {
  const cls =
    tone === "amber" ? "text-amber-800 bg-amber-50/70 border-amber-200"
      : tone === "rose" ? "text-rose-800 bg-rose-50/70 border-rose-200"
        : tone === "cyan" ? "text-primary bg-primary/10 border-primary/30"
          : "text-emerald-800 bg-emerald-50/70 border-emerald-200";
  return <div data-pdf="insight" className={`text-xs rounded-md border px-3 py-2 ${cls}`}>{children}</div>;
}
