"use client";

/**
 * Custom from→to date-range control for the Team Dashboard. Sits next to the
 * quick presets (This month / Last 30 days / This FY) and lets the user pick an
 * arbitrary range; selecting a date navigates the page with ?from=&to= (the
 * member filter is preserved). Picking the same range as a preset re-highlights
 * that preset automatically (the server compares ranges).
 */

import { useRouter } from "next/navigation";
import { DatePicker } from "@/components/ui/DatePicker";

export function TeamRangePicker({
  from,
  to,
  member,
}: {
  from: string;
  to: string;
  member?: string;
}) {
  const router = useRouter();

  function nav(f: string, t: string) {
    const params = new URLSearchParams();
    if (f) params.set("from", f);
    if (t) params.set("to", t);
    if (member) params.set("member", member);
    const qs = params.toString();
    router.push(`/dashboard/team${qs ? `?${qs}` : ""}`);
  }

  return (
    <div className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2 h-8">
      <span className="text-xs text-muted-foreground whitespace-nowrap">Custom</span>
      <DatePicker
        size="sm"
        value={from}
        onChange={(f) => nav(f, to)}
        max={to || undefined}
        ariaLabel="From date"
        className="w-[7.5rem]"
      />
      <span className="text-muted-foreground">→</span>
      <DatePicker
        size="sm"
        value={to}
        onChange={(t) => nav(from, t)}
        min={from || undefined}
        ariaLabel="To date"
        className="w-[7.5rem]"
      />
    </div>
  );
}
