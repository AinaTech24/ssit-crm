"use client";

/**
 * Theme-aware date / datetime / time picker — a native date input styled to the
 * app's input theme, with a calendar (or clock) affordance and a value-driven
 * onChange. The default browser picker indicator is hidden and replaced by our
 * own icon (the invisible native indicator still sits over the icon so a click
 * opens the picker). `[color-scheme]` makes the native popup theme-correct.
 */

import type { InputHTMLAttributes } from "react";
import { Calendar, Clock } from "lucide-react";

export function ThemeDate({
  value,
  onChange,
  type = "date",
  className = "",
  wrapperClassName = "",
  ...rest
}: {
  value: string;
  onChange: (v: string) => void;
  type?: "date" | "datetime-local" | "time" | "month";
  className?: string;
  wrapperClassName?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">) {
  const Icon = type === "time" ? Clock : Calendar;
  return (
    <div className={`relative ${wrapperClassName}`}>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`input-base pr-9 dark:[color-scheme:dark]
          [&::-webkit-calendar-picker-indicator]:absolute
          [&::-webkit-calendar-picker-indicator]:right-0
          [&::-webkit-calendar-picker-indicator]:top-0
          [&::-webkit-calendar-picker-indicator]:h-full
          [&::-webkit-calendar-picker-indicator]:w-9
          [&::-webkit-calendar-picker-indicator]:cursor-pointer
          [&::-webkit-calendar-picker-indicator]:opacity-0 ${className}`}
        {...rest}
      />
      <Icon className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
    </div>
  );
}
