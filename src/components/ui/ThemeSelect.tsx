"use client";

/**
 * Theme-aware dropdown — a native <select> styled to match the app's input
 * theme (light/dark), with a chevron affordance and a value-driven onChange.
 * Native under the hood, so it keeps full keyboard + mobile accessibility; the
 * `[color-scheme]` hint makes the option list render correctly in dark mode.
 *
 * Two usage shapes:
 *   <ThemeSelect value={v} onChange={setV} options={[["a","A"],["b","B"]]} />
 *   <ThemeSelect value={v} onChange={setV}><option …/>…</ThemeSelect>
 */

import type { SelectHTMLAttributes, ReactNode } from "react";
import { ChevronDown } from "lucide-react";

type Opt = [string, string];

export function ThemeSelect({
  value,
  onChange,
  options,
  children,
  className = "",
  wrapperClassName = "",
  ...rest
}: {
  value: string;
  onChange: (v: string) => void;
  options?: Opt[];
  children?: ReactNode;
  className?: string;
  wrapperClassName?: string;
} & Omit<SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange" | "children">) {
  return (
    <div className={`relative ${wrapperClassName}`}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`input-base appearance-none pr-9 cursor-pointer dark:[color-scheme:dark] ${className}`}
        {...rest}
      >
        {options ? options.map(([k, l]) => <option key={k} value={k}>{l}</option>) : children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
    </div>
  );
}
