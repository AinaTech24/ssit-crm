"use client";

/**
 * "Which kind of meeting?" for the RM meetings table: all of them, or only New /
 * Review / Follow-up. Writes `?mtype=` on whatever page it sits on, so the
 * dashboard and the Meeting details page both keep their other filters.
 */

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Presentation } from "lucide-react";

export const MEETING_TYPE_OPTIONS = [
  { value: "", label: "All meetings" },
  { value: "review", label: "Review meetings" },
  { value: "new", label: "New meetings" },
  { value: "follow_up", label: "Follow-up meetings" },
] as const;

export function MeetingTypeFilter({ selected }: { selected?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  function go(v: string) {
    const params = new URLSearchParams(sp?.toString() ?? "");
    if (v) params.set("mtype", v);
    else params.delete("mtype");
    const qs = params.toString();
    router.push(`${pathname}${qs ? `?${qs}` : ""}`);
  }

  return (
    <div className="inline-flex items-center gap-1.5">
      <Presentation className="size-3.5 text-muted-foreground" />
      <select
        value={selected ?? ""}
        onChange={(e) => go(e.target.value)}
        className="input-base h-8 text-xs py-0 pr-7"
        aria-label="Filter by meeting type"
      >
        {MEETING_TYPE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
