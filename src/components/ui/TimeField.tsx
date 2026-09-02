"use client";

/**
 * Themed time picker — branded replacement for a native <input type="time">
 * (whose dropdown is browser-chrome and can't be styled). Two custom Select
 * dropdowns (hour 00–23 · minute, 5-min steps) that read/write a "HH:MM" string.
 *
 *   <TimeField value="09:00" onChange={setTime} />
 */

import { Clock } from "lucide-react";
import { SelectField } from "./SelectField";

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0"));

export function TimeField({
  value,
  onChange,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  const [hh = "09", mm = "00"] = (value || "09:00").split(":");
  // Snap an off-grid minute (e.g. 07) to the nearest listed option so it shows.
  const mmShown = MINUTES.includes(mm) ? mm : String(Math.round(parseInt(mm || "0", 10) / 5) * 5 % 60).padStart(2, "0");
  return (
    <div className={`inline-flex items-center gap-1.5 ${className}`}>
      <Clock className="size-3.5 text-muted-foreground shrink-0" />
      <SelectField value={hh} onChange={(e) => onChange(`${e.target.value}:${mmShown}`)} className="w-[68px]" size="sm" aria-label="Hour">
        {HOURS.map((h) => <option key={h} value={h}>{h}</option>)}
      </SelectField>
      <span className="text-muted-foreground font-semibold">:</span>
      <SelectField value={mmShown} onChange={(e) => onChange(`${hh}:${e.target.value}`)} className="w-[68px]" size="sm" aria-label="Minute">
        {MINUTES.map((m) => <option key={m} value={m}>{m}</option>)}
      </SelectField>
    </div>
  );
}
